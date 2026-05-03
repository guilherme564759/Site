const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const MANAGER_PASSWORD = process.env.MANAGER_PASSWORD || "admin123";

const dbPath = path.join(__dirname, "data", "rso.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS relatorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prefixo TEXT NOT NULL,
      unidade TEXT NOT NULL,
      equipe TEXT NOT NULL,
      bancos TEXT,
      local TEXT,
      horario TEXT,
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

  db.get("SELECT COUNT(*) AS total FROM permissoes", (err, row) => {
    if (!err && row.total === 0) {
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

function requireManager(req, res, next) {
  if (!req.session.manager) return res.redirect("/manager/login");
  next();
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      err ? reject(err) : resolve(this);
    });
  });
}

app.get("/", (req, res) => {
  res.render("home");
});

app.get("/novo-rso", (req, res) => {
  res.render("novo-rso", { sucesso: false });
});

app.post("/novo-rso", async (req, res) => {
  try {
    const { prefixo, unidade, equipe, bancos, local, horario, relato, material } = req.body;

    await dbRun(`
      INSERT INTO relatorios
      (prefixo, unidade, equipe, bancos, local, horario, relato, material)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [prefixo, unidade, equipe, bancos, local, horario, relato, material]);

    res.render("novo-rso", { sucesso: true });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao enviar RSO.");
  }
});

app.get("/manager/login", (req, res) => {
  res.render("login", { erro: null });
});

app.post("/manager/login", async (req, res) => {
  const { nome, senha } = req.body;

  const manager = await dbGet("SELECT * FROM permissoes WHERE nome = ? AND senha = ?", [nome, senha]);

  if (!manager) {
    return res.render("login", { erro: "Usuário ou senha incorretos." });
  }

  req.session.manager = { id: manager.id, nome: manager.nome };
  res.redirect("/manager");
});

app.get("/manager/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/manager", requireManager, async (req, res) => {
  const status = req.query.status || "pendente";

  const relatorios = await dbAll(
    "SELECT * FROM relatorios WHERE status = ? ORDER BY id DESC",
    [status]
  );

  res.render("manager", {
    relatorios,
    status,
    manager: req.session.manager
  });
});

app.get("/manager/rso/:id", requireManager, async (req, res) => {
  const rso = await dbGet("SELECT * FROM relatorios WHERE id = ?", [req.params.id]);

  if (!rso) return res.status(404).send("RSO não encontrado.");

  res.render("ver-rso", {
    rso,
    manager: req.session.manager
  });
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

app.get("/manager/permissoes", requireManager, async (req, res) => {
  const permissoes = await dbAll("SELECT id, nome, criado_em FROM permissoes ORDER BY id DESC");
  res.render("permissoes", {
    permissoes,
    manager: req.session.manager
  });
});

app.post("/manager/permissoes", requireManager, async (req, res) => {
  const { nome, senha } = req.body;

  if (nome && senha) {
    await dbRun("INSERT INTO permissoes (nome, senha) VALUES (?, ?)", [nome, senha]);
  }

  res.redirect("/manager/permissoes");
});

app.post("/manager/permissoes/:id/remover", requireManager, async (req, res) => {
  const count = await dbGet("SELECT COUNT(*) AS total FROM permissoes");

  if (Number(count.total) > 1) {
    await dbRun("DELETE FROM permissoes WHERE id = ?", [req.params.id]);
  }

  res.redirect("/manager/permissoes");
});

app.listen(PORT, () => {
  console.log(`Sistema RSO rodando na porta ${PORT}`);
});
