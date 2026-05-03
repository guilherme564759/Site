const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || "admin123";

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "rso.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("Erro ao abrir SQLite:", err.message);
  else console.log("Banco SQLite conectado:", dbPath);
});

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
  const minutos = Math.max(0, saida - inicio);
  return Number((minutos / 60).toFixed(2));
}

function formatarHoras(valor) {
  const totalMin = Math.round(Number(valor || 0) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      senha TEXT NOT NULL,
      patente TEXT,
      criado_em TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS relatorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      nome_envio TEXT NOT NULL,
      prefixo TEXT NOT NULL,
      unidade TEXT NOT NULL,
      motorista TEXT,
      encarregado TEXT,
      terceiro TEXT,
      quarto TEXT,
      hora_inicio TEXT,
      hora_saida TEXT,
      horas_total REAL DEFAULT 0,
      relato TEXT NOT NULL,
      material TEXT,
      status TEXT DEFAULT 'pendente',
      criado_em TEXT DEFAULT CURRENT_TIMESTAMP,
      aprovado_por TEXT,
      observacao_manager TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS permissoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      senha TEXT NOT NULL,
      criado_em TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.all("PRAGMA table_info(relatorios)", (err, rows) => {
    if (!err && rows) {
      const existentes = rows.map(r => r.name);
      const cols = [
        ["usuario_id", "INTEGER"],
        ["nome_envio", "TEXT DEFAULT 'Não informado'"],
        ["motorista", "TEXT"],
        ["encarregado", "TEXT"],
        ["terceiro", "TEXT"],
        ["quarto", "TEXT"],
        ["hora_inicio", "TEXT"],
        ["hora_saida", "TEXT"],
        ["horas_total", "REAL DEFAULT 0"]
      ];

      cols.forEach(([nome, tipo]) => {
        if (!existentes.includes(nome)) db.run(`ALTER TABLE relatorios ADD COLUMN ${nome} ${tipo}`);
      });
    }
  });

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

app.use(session({
  secret: process.env.SESSION_SECRET || "rso-secret-key",
  resave: false,
  saveUninitialized: false
}));

function requireUser(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

function requireManager(req, res, next) {
  if (!req.session.manager) return res.redirect("/manager/login");
  next();
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

app.locals.formatarHoras = formatarHoras;

app.get("/", (req, res) => {
  res.render("home", {
    enviado: req.query.enviado === "1",
    user: req.session.user || null
  });
});

app.get("/cadastro", (req, res) => {
  res.render("cadastro", { erro: null, user: req.session.user || null });
});

app.post("/cadastro", async (req, res) => {
  try {
    const { nome, senha, patente } = req.body;

    if (!nome || !senha) {
      return res.render("cadastro", { erro: "Preencha nome e senha.", user: null });
    }

    await dbRun("INSERT INTO usuarios (nome, senha, patente) VALUES (?, ?, ?)", [nome.trim(), senha.trim(), patente || ""]);
    res.redirect("/login");
  } catch (err) {
    console.error(err);
    res.render("cadastro", { erro: "Esse nome já existe. Escolha outro.", user: null });
  }
});

app.get("/login", (req, res) => {
  res.render("login-user", { erro: null, user: req.session.user || null });
});

app.post("/login", async (req, res) => {
  try {
    const { nome, senha } = req.body;
    const user = await dbGet("SELECT * FROM usuarios WHERE nome = ? AND senha = ?", [nome.trim(), senha.trim()]);

    if (!user) return res.render("login-user", { erro: "Nome ou senha incorretos.", user: null });

    req.session.user = { id: user.id, nome: user.nome, patente: user.patente };
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.render("login-user", { erro: "Erro ao entrar.", user: null });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/novo-rso", requireUser, (req, res) => {
  res.render("novo-rso", { user: req.session.user });
});

app.post("/novo-rso", requireUser, async (req, res) => {
  try {
    const {
      prefixo, unidade, motorista, encarregado,
      terceiro, quarto, hora_inicio, hora_saida, relato, material
    } = req.body;

    const horas_total = calcularHoras(hora_inicio, hora_saida);

    await dbRun(`
      INSERT INTO relatorios
      (usuario_id, nome_envio, prefixo, unidade, motorista, encarregado, terceiro, quarto, hora_inicio, hora_saida, horas_total, relato, material)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.session.user.id,
      req.session.user.nome,
      prefixo, unidade, motorista, encarregado,
      terceiro || "Não informado", quarto || "Não informado",
      hora_inicio, hora_saida, horas_total, relato, material || "Nada apreendido"
    ]);

    res.redirect("/?enviado=1");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao enviar RSO.");
  }
});

app.get("/meus-rso", requireUser, async (req, res) => {
  const relatorios = await dbAll(
    "SELECT * FROM relatorios WHERE usuario_id = ? ORDER BY id DESC",
    [req.session.user.id]
  );

  const soma = await dbGet(
    "SELECT COALESCE(SUM(horas_total), 0) AS total FROM relatorios WHERE usuario_id = ? AND status = 'aprovado'",
    [req.session.user.id]
  );

  res.render("meus-rso", {
    user: req.session.user,
    relatorios,
    total: soma?.total || 0
  });
});

app.get("/manager/login", (req, res) => res.render("login", { erro: null }));

app.post("/manager/login", async (req, res) => {
  try {
    const { nome, senha } = req.body;
    const manager = await dbGet("SELECT * FROM permissoes WHERE nome = ? AND senha = ?", [nome, senha]);

    if (!manager) return res.render("login", { erro: "Usuário ou senha incorretos." });

    req.session.manager = { id: manager.id, nome: manager.nome };
    res.redirect("/manager");
  } catch (err) {
    console.error(err);
    res.render("login", { erro: "Erro ao acessar o painel." });
  }
});

app.get("/manager/logout", (req, res) => req.session.destroy(() => res.redirect("/")));

app.get("/manager", requireManager, async (req, res) => {
  const status = req.query.status || "pendente";
  const relatorios = await dbAll("SELECT * FROM relatorios WHERE status = ? ORDER BY id DESC", [status]);

  const cards = {
    pendentes: (await dbGet("SELECT COUNT(*) AS total FROM relatorios WHERE status='pendente'"))?.total || 0,
    aprovados: (await dbGet("SELECT COUNT(*) AS total FROM relatorios WHERE status='aprovado'"))?.total || 0,
    recusados: (await dbGet("SELECT COUNT(*) AS total FROM relatorios WHERE status='recusado'"))?.total || 0,
    horas: (await dbGet("SELECT COALESCE(SUM(horas_total), 0) AS total FROM relatorios WHERE status='aprovado'"))?.total || 0
  };

  res.render("manager", { relatorios, status, manager: req.session.manager, cards });
});

app.get("/manager/rso/:id", requireManager, async (req, res) => {
  const rso = await dbGet("SELECT * FROM relatorios WHERE id = ?", [req.params.id]);
  if (!rso) return res.status(404).send("RSO não encontrado.");
  res.render("ver-rso", { rso, manager: req.session.manager });
});

app.post("/manager/rso/:id/aprovar", requireManager, async (req, res) => {
  await dbRun(`
    UPDATE relatorios
    SET status = 'aprovado', aprovado_por = ?, observacao_manager = ?
    WHERE id = ?
  `, [req.session.manager.nome, req.body.observacao || "", req.params.id]);

  res.redirect("/manager?status=pendente");
});

app.post("/manager/rso/:id/recusar", requireManager, async (req, res) => {
  await dbRun(`
    UPDATE relatorios
    SET status = 'recusado', aprovado_por = ?, observacao_manager = ?
    WHERE id = ?
  `, [req.session.manager.nome, req.body.observacao || "", req.params.id]);

  res.redirect("/manager?status=pendente");
});

app.get("/manager/horas", requireManager, async (req, res) => {
  const usuarios = await dbAll(`
    SELECT nome_envio, COUNT(*) AS total_rso, COALESCE(SUM(horas_total), 0) AS total_horas
    FROM relatorios
    WHERE status = 'aprovado'
    GROUP BY usuario_id, nome_envio
    ORDER BY total_horas DESC
  `);
  res.render("horas", { usuarios, manager: req.session.manager });
});

app.get("/manager/permissoes", requireManager, async (req, res) => {
  const permissoes = await dbAll("SELECT id, nome, criado_em FROM permissoes ORDER BY id DESC");
  res.render("permissoes", { permissoes, manager: req.session.manager });
});

app.post("/manager/permissoes", requireManager, async (req, res) => {
  const { nome, senha } = req.body;
  if (nome && senha) await dbRun("INSERT INTO permissoes (nome, senha) VALUES (?, ?)", [nome, senha]);
  res.redirect("/manager/permissoes");
});

app.post("/manager/permissoes/:id/remover", requireManager, async (req, res) => {
  const count = await dbGet("SELECT COUNT(*) AS total FROM permissoes");
  if (Number(count.total) > 1) await dbRun("DELETE FROM permissoes WHERE id = ?", [req.params.id]);
  res.redirect("/manager/permissoes");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Sistema RSO rodando na porta ${PORT}`);
});
