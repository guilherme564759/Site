const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || "admin123";
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL || "";
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || "";

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(path.join(dataDir, "rso.db"));

const UNIDADES = ["Radiopatrulha","DPM","FT","BAEP","CAEP","ROTA","ANCHIETA","HUMAITÁ","COE/GATE","BPRV","Trânsito","Outra"];
const STATUS = ["pendente", "aprovado", "recusado"];

function calcularHoras(horaInicio, horaSaida) {
  if (!horaInicio || !horaSaida) return 0;
  const normalizar = (valor) => {
    const txt = String(valor).trim().toLowerCase().replace("h", ":");
    const partes = txt.split(":");
    const h = Number(partes[0]);
    const m = Number(partes[1] || 0);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  let inicio = normalizar(horaInicio);
  let saida = normalizar(horaSaida);
  if (inicio === null || saida === null) return 0;
  if (saida < inicio) saida += 24 * 60;
  return Number(((saida - inicio) / 60).toFixed(2));
}

function formatarHoras(valor) {
  const totalMin = Math.round(Number(valor || 0) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

function discordAvatar(user) {
  if (!user?.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

function displayDiscordName(member, user) {
  return member?.nick || user?.global_name || user?.username || "Usuário Discord";
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this); }));
}

async function discordApi(endpoint, token, isBot = false) {
  const headers = isBot
    ? { Authorization: `Bot ${token}` }
    : { Authorization: `Bearer ${token}` };

  const res = await fetch(`https://discord.com/api/v10${endpoint}`, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Discord API ${res.status}: ${txt}`);
  }
  return res.json();
}

async function upsertUsuarioDiscord({ user, member = null }) {
  const nome = displayDiscordName(member, user);
  const avatar = discordAvatar(user);
  const username = user.username || nome;

  await dbRun(`
    INSERT INTO usuarios (discord_id, nome, discord_username, avatar, ativo)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(discord_id) DO UPDATE SET
      nome=excluded.nome,
      discord_username=excluded.discord_username,
      avatar=excluded.avatar,
      ativo=1
  `, [user.id, nome, username, avatar]);

  return dbGet("SELECT * FROM usuarios WHERE discord_id = ?", [user.id]);
}

async function syncGuildMembers(limit = 1000) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return { ok: false, error: "DISCORD_BOT_TOKEN ou DISCORD_GUILD_ID ausente." };

  let after = "0";
  let total = 0;

  while (total < limit) {
    const batchLimit = Math.min(1000, limit - total);
    const members = await discordApi(`/guilds/${DISCORD_GUILD_ID}/members?limit=${batchLimit}&after=${after}`, DISCORD_BOT_TOKEN, true);

    if (!Array.isArray(members) || members.length === 0) break;

    for (const m of members) {
      if (!m.user || m.user.bot) continue;
      await upsertUsuarioDiscord({ user: m.user, member: m });
      after = m.user.id;
      total++;
    }

    if (members.length < batchLimit) break;
  }

  return { ok: true, total };
}

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE,
    nome TEXT NOT NULL,
    discord_username TEXT,
    avatar TEXT,
    patente TEXT,
    unidade TEXT,
    ativo INTEGER DEFAULT 1,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS relatorios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    nome_envio TEXT NOT NULL,
    prefixo TEXT NOT NULL,
    unidade TEXT NOT NULL,
    motorista_id INTEGER,
    motorista_nome TEXT,
    encarregado_id INTEGER,
    encarregado_nome TEXT,
    terceiro_id INTEGER,
    terceiro_nome TEXT,
    quarto_id INTEGER,
    quarto_nome TEXT,
    hora_inicio TEXT,
    hora_saida TEXT,
    horas_total REAL DEFAULT 0,
    relato TEXT NOT NULL,
    material TEXT,
    status TEXT DEFAULT 'pendente',
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
    aprovado_por TEXT,
    observacao_manager TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS permissoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL UNIQUE,
    senha TEXT NOT NULL,
    criado_em TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.get("SELECT COUNT(*) AS total FROM permissoes", (err, row) => {
    if (!err && row && row.total === 0) {
      db.run("INSERT INTO permissoes (nome, senha) VALUES (?, ?)", ["Administrador", MANAGER_PASSWORD]);
    }
  });
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "rso-secret-key",
  resave: false,
  saveUninitialized: false
}));

app.locals.formatarHoras = formatarHoras;
app.locals.UNIDADES = UNIDADES;
app.locals.STATUS = STATUS;

function requireUser(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireManager(req, res, next) {
  if (!req.session.manager) return res.redirect("/manager/login");
  next();
}

async function usuarioPorId(id) {
  if (!id) return null;
  return dbGet("SELECT id, nome, patente, unidade, avatar, discord_id FROM usuarios WHERE id=? AND ativo=1", [id]);
}

app.get("/", (req, res) => {
  res.render("home", { enviado: req.query.enviado === "1", user: req.session.user || null });
});

app.get("/login", (req, res) => {
  res.render("login-user", {
    erro: req.query.erro || null,
    discordConfigured: Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_CALLBACK_URL),
    user: req.session.user || null
  });
});

app.get("/auth/discord", (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CALLBACK_URL) return res.redirect("/login?erro=Discord OAuth não configurado.");

  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_CALLBACK_URL,
    response_type: "code",
    scope: "identify guilds.members.read",
    prompt: "none"
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.redirect("/login?erro=Login cancelado.");

    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_CALLBACK_URL
      })
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text().catch(() => "");
      console.error(txt);
      return res.redirect("/login?erro=Erro ao autenticar com Discord.");
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const user = await discordApi("/users/@me", accessToken, false);
    let member = null;

    if (DISCORD_GUILD_ID) {
      try {
        member = await discordApi(`/users/@me/guilds/${DISCORD_GUILD_ID}/member`, accessToken, false);
      } catch {
        return res.redirect("/login?erro=Você precisa estar no servidor Discord configurado.");
      }
    }

    const localUser = await upsertUsuarioDiscord({ user, member });
    req.session.user = {
      id: localUser.id,
      discord_id: localUser.discord_id,
      nome: localUser.nome,
      avatar: localUser.avatar,
      patente: localUser.patente,
      unidade: localUser.unidade
    };

    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.redirect("/login?erro=Erro no login Discord.");
  }
});

app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/")));

app.get("/api/usuarios", requireUser, async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 1) return res.json([]);

  const users = await dbAll(`
    SELECT id, nome, patente, unidade, avatar
    FROM usuarios
    WHERE ativo=1 AND LOWER(nome) LIKE LOWER(?)
    ORDER BY nome ASC
    LIMIT 12
  `, [`%${q}%`]);

  res.json(users);
});

app.get("/novo-rso", requireUser, (req, res) => res.render("novo-rso", { user: req.session.user }));

app.post("/novo-rso", requireUser, async (req, res) => {
  try {
    const { prefixo, unidade, motorista_id, encarregado_id, terceiro_id, quarto_id, hora_inicio, hora_saida, relato, material } = req.body;

    const motorista = await usuarioPorId(motorista_id);
    const encarregado = await usuarioPorId(encarregado_id);
    const terceiro = await usuarioPorId(terceiro_id);
    const quarto = await usuarioPorId(quarto_id);

    if (!motorista || !encarregado) {
      return res.status(400).send("Motorista e encarregado precisam ser selecionados pela lista de usuários.");
    }

    const horas_total = calcularHoras(hora_inicio, hora_saida);

    await dbRun(`INSERT INTO relatorios
      (usuario_id, nome_envio, prefixo, unidade,
       motorista_id, motorista_nome, encarregado_id, encarregado_nome,
       terceiro_id, terceiro_nome, quarto_id, quarto_nome,
       hora_inicio, hora_saida, horas_total, relato, material)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.session.user.id, req.session.user.nome, prefixo, unidade,
        motorista.id, motorista.nome, encarregado.id, encarregado.nome,
        terceiro?.id || null, terceiro?.nome || "Não informado",
        quarto?.id || null, quarto?.nome || "Não informado",
        hora_inicio, hora_saida, horas_total, relato, material || "Nada apreendido"
      ]);

    res.redirect("/?enviado=1");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao enviar RSO.");
  }
});

app.get("/meus-rso", requireUser, async (req, res) => {
  const id = req.session.user.id;

  const relatorios = await dbAll(`
    SELECT * FROM relatorios
    WHERE usuario_id = ?
       OR motorista_id = ?
       OR encarregado_id = ?
       OR terceiro_id = ?
       OR quarto_id = ?
    ORDER BY id DESC
  `, [id, id, id, id, id]);

  const soma = await dbGet(`
    SELECT COALESCE(SUM(horas_total),0) AS total FROM relatorios
    WHERE status='aprovado'
    AND (usuario_id=? OR motorista_id=? OR encarregado_id=? OR terceiro_id=? OR quarto_id=?)
  `, [id, id, id, id, id]);

  const cards = {
    pendentes: (await dbGet(`SELECT COUNT(*) AS total FROM relatorios WHERE status='pendente' AND (usuario_id=? OR motorista_id=? OR encarregado_id=? OR terceiro_id=? OR quarto_id=?)`, [id,id,id,id,id])).total,
    aprovados: (await dbGet(`SELECT COUNT(*) AS total FROM relatorios WHERE status='aprovado' AND (usuario_id=? OR motorista_id=? OR encarregado_id=? OR terceiro_id=? OR quarto_id=?)`, [id,id,id,id,id])).total,
    recusados: (await dbGet(`SELECT COUNT(*) AS total FROM relatorios WHERE status='recusado' AND (usuario_id=? OR motorista_id=? OR encarregado_id=? OR terceiro_id=? OR quarto_id=?)`, [id,id,id,id,id])).total
  };

  res.render("meus-rso", { user: req.session.user, relatorios, total: soma.total, cards });
});

app.get("/manager/login", (req, res) => res.render("login", { erro: null }));

app.post("/manager/login", async (req, res) => {
  const { nome, senha } = req.body;
  const manager = await dbGet("SELECT * FROM permissoes WHERE nome = ? AND senha = ?", [String(nome).trim(), String(senha).trim()]);
  if (!manager) return res.render("login", { erro: "Usuário ou senha incorretos." });
  req.session.manager = { id: manager.id, nome: manager.nome };
  res.redirect("/manager");
});

app.get("/manager/logout", (req, res) => req.session.destroy(() => res.redirect("/")));

app.get("/manager", requireManager, async (req, res) => {
  const status = req.query.status || "pendente";
  const unidade = req.query.unidade || "todas";
  const policial = (req.query.policial || "").trim();

  let where = ["status = ?"];
  let params = [status];

  if (unidade !== "todas") {
    where.push("unidade = ?");
    params.push(unidade);
  }

  if (policial) {
    where.push(`(
      LOWER(nome_envio) LIKE LOWER(?)
      OR LOWER(motorista_nome) LIKE LOWER(?)
      OR LOWER(encarregado_nome) LIKE LOWER(?)
      OR LOWER(terceiro_nome) LIKE LOWER(?)
      OR LOWER(quarto_nome) LIKE LOWER(?)
    )`);
    params.push(`%${policial}%`, `%${policial}%`, `%${policial}%`, `%${policial}%`, `%${policial}%`);
  }

  const relatorios = await dbAll(`SELECT * FROM relatorios WHERE ${where.join(" AND ")} ORDER BY id DESC`, params);

  const cards = {
    pendentes: (await dbGet("SELECT COUNT(*) AS total FROM relatorios WHERE status='pendente'")).total,
    aprovados: (await dbGet("SELECT COUNT(*) AS total FROM relatorios WHERE status='aprovado'")).total,
    recusados: (await dbGet("SELECT COUNT(*) AS total FROM relatorios WHERE status='recusado'")).total,
    horas: (await dbGet("SELECT COALESCE(SUM(horas_total),0) AS total FROM relatorios WHERE status='aprovado'")).total,
    total: (await dbGet("SELECT COUNT(*) AS total FROM relatorios")).total
  };

  const porUnidade = await dbAll(`
    SELECT unidade, COUNT(*) AS total, COALESCE(SUM(CASE WHEN status='aprovado' THEN horas_total ELSE 0 END),0) AS horas
    FROM relatorios
    GROUP BY unidade
    ORDER BY total DESC
  `);

  res.render("manager", { relatorios, status, unidade, policial, manager: req.session.manager, cards, porUnidade, unidades: UNIDADES });
});

app.get("/manager/rso/:id", requireManager, async (req, res) => {
  const rso = await dbGet("SELECT * FROM relatorios WHERE id = ?", [req.params.id]);
  if (!rso) return res.status(404).send("RSO não encontrado.");
  res.render("ver-rso", { rso, manager: req.session.manager });
});

app.post("/manager/rso/:id/aprovar", requireManager, async (req, res) => {
  await dbRun("UPDATE relatorios SET status='aprovado', aprovado_por=?, observacao_manager=? WHERE id=?",
    [req.session.manager.nome, req.body.observacao || "", req.params.id]);
  res.redirect("/manager?status=pendente");
});

app.post("/manager/rso/:id/recusar", requireManager, async (req, res) => {
  await dbRun("UPDATE relatorios SET status='recusado', aprovado_por=?, observacao_manager=? WHERE id=?",
    [req.session.manager.nome, req.body.observacao || "", req.params.id]);
  res.redirect("/manager?status=pendente");
});

app.get("/manager/horas", requireManager, async (req, res) => {
  const policial = (req.query.policial || "").trim();
  let selecionado = null;

  if (policial) {
    selecionado = await dbGet(`
      SELECT u.nome,
      COUNT(DISTINCT r.id) AS total_rso,
      COALESCE(SUM(CASE WHEN r.status='aprovado' THEN r.horas_total ELSE 0 END),0) AS total_horas,
      SUM(CASE WHEN r.status='pendente' THEN 1 ELSE 0 END) AS pendentes,
      SUM(CASE WHEN r.status='aprovado' THEN 1 ELSE 0 END) AS aprovados,
      SUM(CASE WHEN r.status='recusado' THEN 1 ELSE 0 END) AS recusados
      FROM usuarios u
      LEFT JOIN relatorios r ON (
        r.usuario_id = u.id OR r.motorista_id = u.id OR r.encarregado_id = u.id OR r.terceiro_id = u.id OR r.quarto_id = u.id
      )
      WHERE LOWER(u.nome) LIKE LOWER(?)
      GROUP BY u.id
      ORDER BY total_horas DESC
      LIMIT 1
    `, [`%${policial}%`]);
  }

  const usuarios = await dbAll(`
    SELECT u.nome,
    COUNT(DISTINCT r.id) AS total_rso,
    COALESCE(SUM(CASE WHEN r.status='aprovado' THEN r.horas_total ELSE 0 END),0) AS total_horas
    FROM usuarios u
    LEFT JOIN relatorios r ON (
      r.usuario_id = u.id OR r.motorista_id = u.id OR r.encarregado_id = u.id OR r.terceiro_id = u.id OR r.quarto_id = u.id
    )
    GROUP BY u.id
    ORDER BY total_horas DESC, u.nome ASC
  `);

  res.render("horas", { usuarios, selecionado, policial, manager: req.session.manager });
});

app.get("/manager/usuarios", requireManager, async (req, res) => {
  const busca = (req.query.busca || "").trim();
  let params = [];
  let sql = "SELECT * FROM usuarios";
  if (busca) {
    sql += " WHERE LOWER(nome) LIKE LOWER(?) OR LOWER(discord_username) LIKE LOWER(?) OR LOWER(patente) LIKE LOWER(?) OR LOWER(unidade) LIKE LOWER(?)";
    params = [`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`];
  }
  sql += " ORDER BY ativo DESC, nome ASC";
  const usuarios = await dbAll(sql, params);
  res.render("usuarios", { usuarios, busca, erro: null, sync: null, manager: req.session.manager, unidades: UNIDADES });
});

app.post("/manager/usuarios/sync", requireManager, async (req, res) => {
  let sync = null;
  let erro = null;
  try {
    sync = await syncGuildMembers(1000);
    if (!sync.ok) erro = sync.error;
  } catch (err) {
    console.error(err);
    erro = "Erro ao sincronizar membros do Discord. Verifique BOT_TOKEN, GUILD_ID e permissões.";
  }
  const usuarios = await dbAll("SELECT * FROM usuarios ORDER BY ativo DESC, nome ASC");
  res.render("usuarios", { usuarios, busca: "", erro, sync, manager: req.session.manager, unidades: UNIDADES });
});

app.post("/manager/usuarios/:id/status", requireManager, async (req, res) => {
  const atual = await dbGet("SELECT ativo FROM usuarios WHERE id=?", [req.params.id]);
  if (atual) await dbRun("UPDATE usuarios SET ativo=? WHERE id=?", [atual.ativo ? 0 : 1, req.params.id]);
  res.redirect("/manager/usuarios");
});

app.post("/manager/usuarios/:id/editar", requireManager, async (req, res) => {
  const { patente, unidade } = req.body;
  await dbRun("UPDATE usuarios SET patente=?, unidade=? WHERE id=?", [patente || "", unidade || "", req.params.id]);
  res.redirect("/manager/usuarios");
});

app.get("/manager/permissoes", requireManager, async (req, res) => {
  const permissoes = await dbAll("SELECT id, nome, criado_em FROM permissoes ORDER BY id DESC");
  res.render("permissoes", { permissoes, manager: req.session.manager, erro: null });
});

app.post("/manager/permissoes", requireManager, async (req, res) => {
  const { nome, senha } = req.body;
  try {
    if (nome && senha) await dbRun("INSERT INTO permissoes (nome, senha) VALUES (?, ?)", [nome.trim(), senha.trim()]);
    res.redirect("/manager/permissoes");
  } catch {
    const permissoes = await dbAll("SELECT id, nome, criado_em FROM permissoes ORDER BY id DESC");
    res.render("permissoes", { permissoes, manager: req.session.manager, erro: "Esse manager já existe." });
  }
});

app.post("/manager/permissoes/:id/remover", requireManager, async (req, res) => {
  const count = await dbGet("SELECT COUNT(*) AS total FROM permissoes");
  if (Number(count.total) > 1) await dbRun("DELETE FROM permissoes WHERE id=?", [req.params.id]);
  res.redirect("/manager/permissoes");
});

app.listen(PORT, "0.0.0.0", () => console.log(`Sistema RSO Discord rodando na porta ${PORT}`));
