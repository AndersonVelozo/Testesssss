// backend.js (Node/Express + Postgres + Cache + Auth + Logs + Painel ADM)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // versão 2 (CommonJS)
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const XLSX = require("xlsx"); // npm i xlsx

const app = express();

// ========== UPLOADS (ANEXOS DE CHAMADOS) ==========
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "");
    cb(null, unique + ext);
  },
});

const upload = multer({ storage });

// rota estática pra baixar os arquivos
app.use("/uploads", express.static(uploadDir));

// ========== CONFIG GERAL ==========
const PORT = process.env.PORT || 3000;
const INFOSIMPLES_TOKEN = process.env.API_TOKEN;
const URL_RADAR = process.env.URL_RADAR;
const CACHE_DIAS = Number(process.env.CACHE_DIAS || 90);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-mude-isso";

// Rota raiz: sempre ir para a tela de login
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Arquivos estáticos (CSS, JS, outras páginas)
app.use(express.static(path.join(__dirname, "public")));

// ========== POSTGRES (Render / Railway) ==========
const isRender = !!process.env.RENDER; // o Render seta isso automaticamente
console.log("Iniciando Pool Postgres. RENDER =", isRender);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRender ? { rejectUnauthorized: false } : false,
});

// cria tabelas se não existir + colunas extras do painel ADM
async function initDb() {
  const sql = `
    CREATE TABLE IF NOT EXISTS consultas_radar (
      id                  BIGSERIAL PRIMARY KEY,
      cnpj                VARCHAR(14) NOT NULL,
      data_consulta       DATE        NOT NULL,
      contribuinte        TEXT,
      situacao            TEXT,
      data_situacao       TEXT,
      submodalidade       TEXT,
      razao_social        TEXT,
      nome_fantasia       TEXT,
      municipio           TEXT,
      uf                  VARCHAR(2),
      data_constituicao   TEXT,
      regime_tributario   TEXT,
      data_opcao_simples  TEXT,
      capital_social      TEXT,
      exportado_por       TEXT,
      consultado_por_id   BIGINT,
      consultado_por_nome TEXT,
      atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dados_incompletos   BOOLEAN     NOT NULL DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS idx_consultas_radar_cnpj_data
      ON consultas_radar (cnpj, data_consulta DESC);

    CREATE TABLE IF NOT EXISTS usuarios (
      id            BIGSERIAL PRIMARY KEY,
      nome          TEXT         NOT NULL,
      email         VARCHAR(120) NOT NULL UNIQUE,
      senha_hash    TEXT         NOT NULL,
      role          VARCHAR(20)  NOT NULL DEFAULT 'user',
      ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
      pode_lote     BOOLEAN      NOT NULL DEFAULT TRUE,
      can_radar     BOOLEAN      NOT NULL DEFAULT TRUE,
      can_chamados  BOOLEAN      NOT NULL DEFAULT TRUE,
      can_chatbot   BOOLEAN      NOT NULL DEFAULT FALSE,
      can_admin     BOOLEAN      NOT NULL DEFAULT FALSE,
      can_master_ti BOOLEAN      NOT NULL DEFAULT FALSE,
      criado_em     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );

    -- garante coluna nova em bancos antigos
    ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS can_chatbot BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS consultas_log (
      id           BIGSERIAL PRIMARY KEY,
      usuario_id   BIGINT      NOT NULL REFERENCES usuarios(id),
      cnpj         VARCHAR(14) NOT NULL,
      data_hora    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      origem       VARCHAR(20) NOT NULL,
      sucesso      BOOLEAN     NOT NULL,
      mensagem     TEXT
    );

    -- ================= CHAMADOS TI =================
    CREATE TABLE IF NOT EXISTS chamados_ti (
      id                BIGSERIAL PRIMARY KEY,
      titulo            TEXT         NOT NULL,
      descricao         TEXT,
      tipo              VARCHAR(30),
      categoria         VARCHAR(50),
      urgencia          VARCHAR(20),
      status            VARCHAR(40) NOT NULL DEFAULT 'new',
      solicitante_id    BIGINT      NOT NULL REFERENCES usuarios(id),
      solicitante_nome  TEXT        NOT NULL,
      responsavel_id    BIGINT,
      responsavel_nome  TEXT,
      criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fechado_em        TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_chamados_ti_status
      ON chamados_ti (status);

    CREATE INDEX IF NOT EXISTS idx_chamados_ti_solicitante
      ON chamados_ti (solicitante_id);

    CREATE TABLE IF NOT EXISTS chamados_ti_atividade (
      id                BIGSERIAL PRIMARY KEY,
      chamado_id        BIGINT      NOT NULL REFERENCES chamados_ti(id) ON DELETE CASCADE,
      tipo              VARCHAR(30) NOT NULL,
      descricao         TEXT        NOT NULL,
      criado_por_id     BIGINT      NOT NULL REFERENCES usuarios(id),
      criado_por_nome   TEXT        NOT NULL,
      criado_em         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_chamados_ti_atividade_chamado
      ON chamados_ti_atividade (chamado_id);

    CREATE TABLE IF NOT EXISTS ti_reservas (
      id          BIGSERIAL PRIMARY KEY,
      usuario_id  BIGINT      NOT NULL REFERENCES usuarios(id),
      data        DATE        NOT NULL,
      periodo     VARCHAR(20) NOT NULL,
      motivo      TEXT,
      criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ti_reservas_usuario_data
      ON ti_reservas (usuario_id, data);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_ti_reservas_unique_usuario_data_periodo
      ON ti_reservas (usuario_id, data, periodo);

    -- 🔧 patch: se existir coluna 'senha' antiga NOT NULL, tornamos NULL
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'usuarios'
          AND column_name = 'senha'
      ) THEN
        BEGIN
          ALTER TABLE usuarios ALTER COLUMN senha DROP NOT NULL;
        EXCEPTION WHEN undefined_column THEN
          NULL;
        END;
      END IF;
    END $$;


     CREATE TABLE IF NOT EXISTS chamados_ti_arquivos (
      id             BIGSERIAL PRIMARY KEY,
      chamado_id     BIGINT      NOT NULL REFERENCES chamados_ti(id) ON DELETE CASCADE,
      nome_original  TEXT        NOT NULL,
      nome_arquivo   TEXT        NOT NULL,
      mimetype       TEXT,
      tamanho        BIGINT,
      criado_em      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_chamados_ti_arquivos_chamado
      ON chamados_ti_arquivos (chamado_id);


      -- NOVA TABELA PARA GUARDAR OS LOTES DE EXPORTAÇÃO
CREATE TABLE historico_exportacoes (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES usuarios(id),
  filtro_tipo    VARCHAR(20) NOT NULL,     -- 'dia' ou 'intervalo'
  data_inicio    DATE NOT NULL,
  data_fim       DATE NOT NULL,
  nome_arquivo   TEXT,                     -- pode ser NULL
  total_registros INTEGER NOT NULL,
  criado_em      TIMESTAMPTZ DEFAULT now()
);

  `;

  await pool.query(sql);
  console.log("✔ Tabelas verificadas/criadas.");

  await seedAdminUser();
}

// cria admin padrão se tabela estiver vazia
async function seedAdminUser() {
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*) AS total FROM usuarios;"
    );
    const total = Number(rows[0]?.total || 0);

    if (total === 0) {
      const nome = "Administrador";
      const email = "admin@radar.local";
      const senhaEmTexto = "admin123"; // TROQUE ISSO ASSIM QUE LOGAR
      const role = "admin";

      const sql = `
  INSERT INTO usuarios
    (nome, email, senha_hash, role, ativo, pode_lote,
     can_radar, can_chamados, can_chatbot, can_admin, can_master_ti)
  VALUES
    ($1,   $2,    $3,         $4,  TRUE,  TRUE,
     TRUE, TRUE,  TRUE,       TRUE, FALSE)
  ON CONFLICT (email) DO NOTHING;
`;

      await pool.query(sql, [nome, email, senhaEmTexto, role]);
      console.log("⚙ Usuário ADMIN criado:");
      console.log(`   Email: ${email}`);
      console.log(`   Senha: ${senhaEmTexto}`);
      console.log("   >> Altere depois pelo painel ADM.");
    }
  } catch (err) {
    console.error("Erro ao criar admin padrão:", err.message);
  }
}

// busca consulta recente (dentro do CACHE_DIAS)
async function getConsultaRecente(cnpjLimpo) {
  const sql = `
    SELECT *
    FROM consultas_radar
    WHERE cnpj = $1
      AND data_consulta >= CURRENT_DATE - INTERVAL '${CACHE_DIAS} days'
    ORDER BY data_consulta DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql, [cnpjLimpo]);
  return rows[0] || null;
}

// grava nova consulta OU atualiza a consulta do dia pro mesmo CNPJ
async function salvarConsulta(cnpjLimpo, dados, usuario) {
  const usuarioId = usuario?.id || null;
  const usuarioNome = usuario?.nome || null;

  const paramsBase = [
    cnpjLimpo,
    dados.contribuinte || null,
    dados.situacao || null,
    dados.dataSituacao || null,
    dados.submodalidade || null,
    dados.razaoSocial || null,
    dados.nomeFantasia || null,
    dados.municipio || null,
    dados.uf || null,
    dados.dataConstituicao || null,
    dados.regimeTributario || null,
    dados.dataOpcaoSimples || null,
    dados.capitalSocial || null,
    usuarioId,
    usuarioNome,
  ];

  const sqlUpdate = `
    UPDATE consultas_radar SET
      contribuinte        = $2,
      situacao            = $3,
      data_situacao       = $4,
      submodalidade       = $5,
      razao_social        = $6,
      nome_fantasia       = $7,
      municipio           = $8,
      uf                  = $9,
      data_constituicao   = $10,
      regime_tributario   = $11,
      data_opcao_simples  = $12,
      capital_social      = $13,
      consultado_por_id   = $14,
      consultado_por_nome = $15,
      atualizado_em       = NOW()
    WHERE cnpj = $1
      AND data_consulta = CURRENT_DATE
    RETURNING *;
  `;

  const updateResult = await pool.query(sqlUpdate, paramsBase);
  if (updateResult.rows[0]) {
    return updateResult.rows[0];
  }

  const sqlInsert = `
    INSERT INTO consultas_radar (
      cnpj,
      data_consulta,
      contribuinte,
      situacao,
      data_situacao,
      submodalidade,
      razao_social,
      nome_fantasia,
      municipio,
      uf,
      data_constituicao,
      regime_tributario,
      data_opcao_simples,
      capital_social,
      consultado_por_id,
      consultado_por_nome,
      atualizado_em
    ) VALUES (
      $1, CURRENT_DATE,
      $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
      $14,$15, NOW()
    )
    RETURNING *;
  `;

  const insertResult = await pool.query(sqlInsert, paramsBase);
  return insertResult.rows[0];
}

// limpeza avançada com regras por tipo de habilitação
async function limparConsultasAntigasAvancado() {
  const sql = `
    DELETE FROM consultas_radar
    WHERE
      (
        situacao = 'NÃO HABILITADA'
        AND data_consulta < CURRENT_DATE - INTERVAL '90 days'
      )
      OR (
        submodalidade ILIKE '%50%'
        AND data_consulta < CURRENT_DATE - INTERVAL '120 days'
      )
      OR (
        submodalidade ILIKE '%150%'
        AND data_consulta < CURRENT_DATE - INTERVAL '120 days'
      )
      OR (
        submodalidade ILIKE '%ILIMITADA%'
        AND data_consulta < CURRENT_DATE - INTERVAL '560 days'
      );
  `;
  const { rowCount } = await pool.query(sql);
  if (rowCount > 0) {
    console.log(`🧹 Limpeza avançada: ${rowCount} registros removidos.`);
  }
}

// ========== LOG DE CONSULTAS ==========
async function registrarLogConsulta(
  usuarioId,
  cnpj,
  origem,
  sucesso,
  mensagem
) {
  try {
    const sql = `
      INSERT INTO consultas_log (usuario_id, cnpj, origem, sucesso, mensagem)
      VALUES ($1, $2, $3, $4, $5);
    `;
    await pool.query(sql, [
      usuarioId,
      cnpj,
      origem || "desconhecida",
      !!sucesso,
      mensagem || null,
    ]);
  } catch (err) {
    console.error("Erro ao registrar log de consulta:", err.message);
  }
}

// ========== HELPERS GERAIS ==========
function normalizarCNPJ(v) {
  return (v || "").replace(/\D/g, "");
}

function formatarCapitalSocial(valorBruto) {
  if (!valorBruto) return "";
  const num = Number(String(valorBruto).replace(",", "."));
  if (!isNaN(num)) {
    return (
      "R$ " +
      num.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return `R$ ${valorBruto}`;
}

// pequena pausa (ms)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// helper genérico para tentar uma função assíncrona com retry
async function tentarComRetry(fn, descricao, maxTentativas = 3, delayMs = 800) {
  let ultimoErro = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const resp = await fn();
      if (resp) {
        if (tentativa > 1) {
          console.log(
            `✔ ${descricao} OK na tentativa ${tentativa}/${maxTentativas}`
          );
        }
        return { ok: true, valor: resp };
      }
    } catch (err) {
      ultimoErro = err;
      console.warn(
        `⚠ Falha em ${descricao} (tentativa ${tentativa}/${maxTentativas}):`,
        err.message || err
      );
      if (tentativa < maxTentativas) {
        await sleep(delayMs);
      }
    }
  }

  console.warn(`❌ ${descricao} falhou após ${maxTentativas} tentativas.`);
  return { ok: false, erro: ultimoErro };
}

// helper para normalizar booleans vindos do front
function parseBool(raw, defaultValue = false) {
  if (raw === undefined || raw === null) return defaultValue;
  if (typeof raw === "boolean") return raw;
  const txt = String(raw).trim().toLowerCase();
  if (["false", "0", "no", "off", "n", "nao", "não"].includes(txt))
    return false;
  if (["true", "1", "yes", "on", "y", "sim", "s"].includes(txt)) return true;
  return defaultValue;
}

/// ========== MIDDLEWARES ==========

// body JSON
app.use(express.json());

// CORS ABERTO
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middleware de autenticação (qualquer usuário logado)
function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "Token não informado" });
  }

  const [tipo, token] = authHeader.split(" ");
  if (tipo !== "Bearer" || !token) {
    return res.status(401).json({ error: "Formato de token inválido" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.id,
      nome: payload.nome,
      email: payload.email,
      role: payload.role,
      pode_lote: payload.pode_lote,
      permissions: payload.permissions || {},
    };
    next();
  } catch (err) {
    console.error("Erro ao verificar token:", err.message);
    return res.status(401).json({ error: "Token inválido ou expirado" });
  }
}

// Middleware específico para rotas ADM
function authMiddlewareAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }
  const perms = req.user.permissions || {};
  if (req.user.role !== "admin" && !perms.admin) {
    return res.status(403).json({ error: "Acesso restrito ao administrador" });
  }
  next();
}

// Middleware: requer permissão para módulo de chamados (self-service)
function requireChamadosPermission(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }

  const perms = req.user.permissions || {};

  if (
    perms.chamados ||
    perms.admin ||
    perms.masterTi ||
    req.user.role === "admin"
  ) {
    return next();
  }

  return res
    .status(403)
    .json({ error: "Acesso restrito ao módulo de chamados de TI." });
}

// Middleware: requer permissão para painel Master TI
function requireMasterTiPermission(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }

  const perms = req.user.permissions || {};

  if (perms.masterTi || perms.admin || req.user.role === "admin") {
    return next();
  }

  return res
    .status(403)
    .json({ error: "Acesso restrito ao Painel Master TI." });
}

// ========== FUNÇÕES DE API (ReceitaWS / Radar) ==========

async function consultaReceitaWsAPI(cnpjLimpo) {
  const url = `https://www.receitaws.com.br/v1/CNPJ/${cnpjLimpo}`;
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`Erro na ReceitaWS: HTTP ${resp.status}`);
  }

  const d = await resp.json();

  if (d.status && d.status !== "OK") {
    throw new Error(d.message || "Erro na ReceitaWS (status != OK)");
  }

  const razaoSocial = d.nome || "";
  const nomeFantasia = d.fantasia || "";
  const municipio = d.municipio || "";
  const uf = d.uf || "";
  const dataConstituicao = d.abertura || "";

  let regimeTributario = "";
  let dataOpcaoSimples = "N/A";

  if (d.simples && typeof d.simples.optante === "boolean") {
    if (d.simples.optante) {
      regimeTributario = "Simples Nacional";
      if (d.simples.data_opcao) {
        dataOpcaoSimples = d.simples.data_opcao;
      } else {
        dataOpcaoSimples = "";
      }
    } else {
      regimeTributario = "Regime Normal (Lucro Real ou Presumido)";
      dataOpcaoSimples = "N/A";
    }
  }

  const capitalSocial = formatarCapitalSocial(d.capital_social);

  return {
    razaoSocial,
    nomeFantasia,
    municipio,
    uf,
    dataConstituicao,
    regimeTributario,
    dataOpcaoSimples,
    capitalSocial,
  };
}

async function consultaRadarAPI(cnpjLimpo) {
  if (!INFOSIMPLES_TOKEN || !URL_RADAR) {
    throw new Error(
      "Backend não configurado: defina API_TOKEN e URL_RADAR no arquivo .env"
    );
  }

  const params = new URLSearchParams();
  params.append("cnpj", cnpjLimpo);
  params.append("token", INFOSIMPLES_TOKEN);
  params.append("timeout", "300");

  const resp = await fetch(URL_RADAR, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    timeout: 300000,
  });

  if (!resp.ok) {
    throw new Error(`Erro na Infosimples RADAR: HTTP ${resp.status}`);
  }

  const json = await resp.json();
  const rawData = json && json.data;
  let dados = null;

  if (Array.isArray(rawData)) {
    dados = rawData[0] || null;
  } else if (rawData && typeof rawData === "object") {
    dados = rawData[0] || rawData["0"] || rawData;
  }

  let contribuinte = "";
  let situacao = "";
  let dataSituacao = "";
  let submodalidade = "";

  if (dados) {
    contribuinte =
      dados.contribuinte || dados.nome_contribuinte || dados.contr_nome || "";
    situacao =
      dados.situacao || dados.situacao_habilitacao || dados.status || "";
    dataSituacao =
      dados.data_situacao ||
      dados.situacao_data ||
      dados.data_situacao_habilitacao ||
      "";
    submodalidade =
      dados.submodalidade ||
      dados.submodalidade_texto ||
      dados.submodalidade_descricao ||
      "";
  }

  return {
    contribuinte,
    situacao,
    dataSituacao,
    submodalidade,
  };
}

// ================= ENDPOINTS AUXILIARES =================

app.get("/consulta-receitaws", async (req, res) => {
  try {
    const cnpj = normalizarCNPJ(req.query.cnpj);
    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }
    const dados = await consultaReceitaWsAPI(cnpj);
    return res.json(dados);
  } catch (err) {
    console.error("Erro /consulta-receitaws:", err);
    return res.status(500).json({ error: err.message || "Erro ReceitaWS" });
  }
});

app.get("/consulta-radar", async (req, res) => {
  try {
    const cnpj = normalizarCNPJ(req.query.cnpj);
    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }
    const dados = await consultaRadarAPI(cnpj);
    return res.json(dados);
  } catch (err) {
    console.error("Erro /consulta-radar:", err);
    return res.status(500).json({ error: err.message || "Erro RADAR" });
  }
});

// ================== AUTH ==================
app.post("/auth/login", async (req, res) => {
  try {
    const { email, senha } = req.body || {};

    if (!email || !senha) {
      return res.status(400).json({ error: "Informe email e senha." });
    }

    const sql = `
  SELECT
    id, nome, email, senha_hash, role, ativo, pode_lote,
    can_radar, can_chamados, can_chatbot, can_admin, can_master_ti
  FROM usuarios
  WHERE email = $1 AND ativo = TRUE
`;
    const { rows } = await pool.query(sql, [email]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    if (String(user.senha_hash).trim() !== String(senha).trim()) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }

    const permissions = {
      radar: !!user.can_radar,
      chamados: !!user.can_chamados,
      chatbot: !!user.can_chatbot,
      admin: !!user.can_admin,
      masterTi: !!user.can_master_ti,
    };

    const token = jwt.sign(
      {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        pode_lote: user.pode_lote,
        permissions,
      },
      JWT_SECRET,
      { expiresIn: "60h" }
    );

    return res.json({
      token,
      usuario: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        ativo: user.ativo,
        pode_lote: user.pode_lote,
        permissions,
      },
    });
  } catch (err) {
    console.error("Erro /auth/login:", err);
    return res.status(500).json({ error: "Erro no login" });
  }
});

app.get("/auth/me", authMiddleware, (req, res) => {
  res.json({ usuario: req.user });
});

// ================= PAINEL ADMIN – CRUD USUÁRIOS =================

// Listar todos os usuários (somente ADM)
app.get(
  "/admin/usuarios",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      const sql = `
  SELECT
      id,
      nome,
      email,
      role,
      ativo,
      pode_lote,
      can_radar,
      can_chamados,
      can_chatbot,
      can_admin,
      can_master_ti
  FROM usuarios
  ORDER BY id DESC;
`;
      const { rows } = await pool.query(sql);
      console.log("GET /admin/usuarios - total registros:", rows.length);
      return res.json(rows);
    } catch (err) {
      console.error("Erro GET /admin/usuarios:", err);
      return res.status(500).json({ error: "Erro ao listar usuários" });
    }
  }
);

// Criar usuário (ADM)
app.post(
  "/admin/usuarios",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      console.log("POST /admin/usuarios body:", req.body);

      const {
        nome,
        email,
        senha,
        role,
        perfil,
        ativo,
        status,
        pode_lote,
        podeLote,
        can_radar,
        canRadar,
        can_chamados,
        canChamados,
        can_chatbot,
        canChatbot,
        can_admin,
        canAdmin,
        can_master_ti,
        canMasterTi,
      } = req.body || {};

      if (!nome || !email || !senha) {
        return res
          .status(400)
          .json({ error: "Nome, e-mail e senha são obrigatórios." });
      }

      const roleInput = String(role || perfil || "")
        .toLowerCase()
        .trim();

      const roleFinal =
        roleInput === "admin" ||
        roleInput === "administrador" ||
        roleInput === "adm"
          ? "admin"
          : "user";

      const ativoFinal = parseBool(ativo ?? status, true);
      const podeLoteFinal = parseBool(pode_lote ?? podeLote, true);

      // permissões de módulo – default false
      const canRadarFinal = parseBool(can_radar ?? canRadar, false);
      const canChamadosFinal = parseBool(can_chamados ?? canChamados, false);
      const canChatbotFinal = parseBool(can_chatbot ?? canChatbot, false);
      const canAdminFinal = parseBool(can_admin ?? canAdmin, false);
      const canMasterTiFinal = parseBool(can_master_ti ?? canMasterTi, false);

      const sql = `
        INSERT INTO usuarios
          (nome, email, senha_hash, role, ativo, pode_lote,
           can_radar, can_chamados, can_chatbot, can_admin, can_master_ti)
        VALUES
          ($1,   $2,    $3,         $4,   $5,    $6,
           $7,       $8,           $9,        $10,      $11)
        RETURNING
          id, nome, email, role, ativo, pode_lote,
          can_radar, can_chamados, can_chatbot, can_admin, can_master_ti,
          criado_em;
      `;

      const { rows } = await pool.query(sql, [
        nome,
        email,
        String(senha).trim(),
        roleFinal,
        ativoFinal,
        podeLoteFinal,
        canRadarFinal,
        canChamadosFinal,
        canChatbotFinal,
        canAdminFinal,
        canMasterTiFinal,
      ]);

      console.log("Usuário criado com sucesso:", rows[0]);
      return res.status(201).json(rows[0]);
    } catch (err) {
      console.error("Erro POST /admin/usuarios:", err);

      if (err.code === "23505") {
        return res
          .status(400)
          .json({ error: "Já existe um usuário com esse e-mail." });
      }

      return res.status(500).json({ error: "Erro ao criar usuário" });
    }
  }
);

app.put(
  "/admin/usuarios/:id",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) {
        return res.status(400).json({ error: "ID inválido." });
      }

      const {
        nome,
        email,
        senha,
        role,
        perfil,
        ativo,
        status,
        pode_lote,
        podeLote,
        can_radar,
        canRadar,
        can_chamados,
        canChamados,
        can_chatbot,
        canChatbot,
        can_admin,
        canAdmin,
        can_master_ti,
        canMasterTi,
      } = req.body || {};

      const campos = [];
      const valores = [];
      let idx = 1;

      if (nome !== undefined) {
        campos.push(`nome = $${idx++}`);
        valores.push(nome);
      }
      if (email !== undefined) {
        campos.push(`email = $${idx++}`);
        valores.push(email);
      }
      if (senha !== undefined && senha !== "") {
        campos.push(`senha_hash = $${idx++}`);
        valores.push(String(senha).trim());
      }
      if (role !== undefined || perfil !== undefined) {
        const roleInput = String(role || perfil || "")
          .toLowerCase()
          .trim();
        const roleFinal =
          roleInput === "admin" ||
          roleInput === "administrador" ||
          roleInput === "adm"
            ? "admin"
            : "user";
        campos.push(`role = $${idx++}`);
        valores.push(roleFinal);
      }
      if (ativo !== undefined || status !== undefined) {
        const ativoFinal = parseBool(ativo ?? status, true);
        campos.push(`ativo = $${idx++}`);
        valores.push(ativoFinal);
      }
      if (pode_lote !== undefined || podeLote !== undefined) {
        const podeLoteFinal = parseBool(pode_lote ?? podeLote, true);
        campos.push(`pode_lote = $${idx++}`);
        valores.push(podeLoteFinal);
      }
      if (can_radar !== undefined || canRadar !== undefined) {
        const val = parseBool(can_radar ?? canRadar, false);
        campos.push(`can_radar = $${idx++}`);
        valores.push(val);
      }
      if (can_chamados !== undefined || canChamados !== undefined) {
        const val = parseBool(can_chamados ?? canChamados, false);
        campos.push(`can_chamados = $${idx++}`);
        valores.push(val);
      }
      if (can_chatbot !== undefined || canChatbot !== undefined) {
        const val = parseBool(can_chatbot ?? canChatbot, false);
        campos.push(`can_chatbot = $${idx++}`);
        valores.push(val);
      }
      if (can_admin !== undefined || canAdmin !== undefined) {
        const val = parseBool(can_admin ?? canAdmin, false);
        campos.push(`can_admin = $${idx++}`);
        valores.push(val);
      }
      if (can_master_ti !== undefined || canMasterTi !== undefined) {
        const val = parseBool(can_master_ti ?? canMasterTi, false);
        campos.push(`can_master_ti = $${idx++}`);
        valores.push(val);
      }

      if (!campos.length) {
        return res
          .status(400)
          .json({ error: "Nenhum campo informado para atualização." });
      }

      valores.push(id);
      const sql = `
        UPDATE usuarios
        SET ${campos.join(", ")}
        WHERE id = $${idx}
        RETURNING
          id, nome, email, role, ativo, pode_lote,
          can_radar, can_chamados, can_chatbot, can_admin, can_master_ti,
          criado_em;
      `;

      const { rows } = await pool.query(sql, valores);
      const user = rows[0];

      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      return res.json(user);
    } catch (err) {
      console.error("Erro PUT /admin/usuarios/:id:", err);
      if (err.code === "23505") {
        return res
          .status(400)
          .json({ error: "Já existe um usuário com esse e-mail." });
      }
      return res.status(500).json({ error: "Erro ao atualizar usuário" });
    }
  }
);

app.delete(
  "/admin/usuarios/:id",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) {
        return res.status(400).json({ error: "ID inválido." });
      }

      const sql = `
        UPDATE usuarios
        SET ativo = FALSE
        WHERE id = $1
        RETURNING
          id, nome, email, role, ativo, pode_lote,
          can_radar, can_chamados, can_chatbot, can_admin, can_master_ti,
          criado_em;
      `;

      const { rows } = await pool.query(sql, [id]);
      const user = rows[0];

      if (!user) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      return res.json({
        message: "Usuário desativado com sucesso.",
        usuario: user,
      });
    } catch (err) {
      console.error("Erro DELETE /admin/usuarios/:id:", err);
      return res.status(500).json({ error: "Erro ao desativar usuário" });
    }
  }
);

// ================= NOVO ENDPOINT UNIFICADO + CACHE POSTGRES (COM AUTH & LOG) =================
/**
 * GET /consulta-completa?cnpj=...&force=1&origem=lote
 * Requer Authorization: Bearer <token>
 */
app.get("/consulta-completa", authMiddleware, async (req, res) => {
  const usuarioId = req.user.id;
  const origem = req.query.origem || "unitaria";

  try {
    const cnpj = normalizarCNPJ(req.query.cnpj);
    const force =
      req.query.force === "1" || req.query.force === "true" ? true : false;

    if (!cnpj) {
      return res.status(400).json({ error: "CNPJ obrigatório" });
    }

    // se for consulta em lote, checa permissão (pode_lote) no banco
    if (origem === "lote") {
      const sql = `
        SELECT role, ativo, pode_lote
        FROM usuarios
        WHERE id = $1
      `;
      const { rows } = await pool.query(sql, [usuarioId]);
      const u = rows[0];

      if (!u || !u.ativo) {
        return res
          .status(403)
          .json({ error: "Usuário inativo ou não encontrado." });
      }

      if (!u.pode_lote && u.role !== "admin") {
        return res.status(403).json({
          error: "Você não tem permissão para consultas em lote.",
        });
      }
    }

    // 🔹 1) Tenta cache primeiro, se NÃO for "force"
    await limparConsultasAntigasAvancado();

    if (!force) {
      const cache = await getConsultaRecente(cnpj);

      if (cache) {
        const cacheSemRadar =
          !cache.situacao &&
          !cache.contribuinte &&
          !cache.submodalidade &&
          !cache.data_situacao;

        if (!cacheSemRadar) {
          await registrarLogConsulta(
            usuarioId,
            cnpj,
            origem,
            true,
            "resposta do cache"
          );

          return res.json({
            fromCache: true,
            dataConsulta: cache.data_consulta,
            cnpj,
            contribuinte: cache.contribuinte || "",
            situacao: cache.situacao || "",
            dataSituacao: cache.data_situacao || "",
            submodalidade: cache.submodalidade || "",
            razaoSocial: cache.razao_social || "",
            nomeFantasia: cache.nome_fantasia || "",
            municipio: cache.municipio || "",
            uf: cache.uf || "",
            dataConstituicao: cache.data_constituicao || "",
            regimeTributario: cache.regime_tributario || "",
            dataOpcaoSimples: cache.data_opcao_simples || "",
            capitalSocial: cache.capital_social || "",
          });
        } else {
          console.log(
            "⚠ Cache ignorado por estar sem dados de habilitação:",
            cnpj
          );
        }
      }
    }

    // 🔹 2) Não tem no cache (ou force=true) → consulta APIs com RETRY
    let radar = null;
    let receita = null;

    let radarFalhou = false;
    let receitaFalhou = false;
    let radarIncompleto = false;

    // RADAR com retry
    const radarResult = await tentarComRetry(
      () => consultaRadarAPI(cnpj),
      `RADAR (${cnpj})`,
      10,
      5000
    );

    if (radarResult.ok) {
      radar = radarResult.valor;
    } else {
      radarFalhou = true;
    }

    // Se o RADAR respondeu mas veio totalmente vazio → marcar como DADOS INDISPONÍVEIS
    if (radar && !radarFalhou) {
      const semCamposRadar =
        !radar.contribuinte &&
        !radar.situacao &&
        !radar.dataSituacao &&
        !radar.submodalidade;

      if (semCamposRadar) {
        radarIncompleto = true;
        radar.situacao = "DADOS INDISPONÍVEIS";
        radar.contribuinte = "";
        radar.dataSituacao = "";
        radar.submodalidade = "";
      }
    }

    // ReceitaWS com retry (10x)
    const receitaResult = await tentarComRetry(
      () => consultaReceitaWsAPI(cnpj),
      `ReceitaWS (${cnpj})`,
      10,
      5000
    );

    if (receitaResult.ok) {
      receita = receitaResult.valor;
    } else {
      receitaFalhou = true;
    }

    // se NENHUMA das duas respondeu, mantém o erro 502
    if (!radar && !receita) {
      await registrarLogConsulta(
        usuarioId,
        cnpj,
        origem,
        false,
        "RADAR e ReceitaWS não responderam após retries"
      );
      return res.status(502).json({
        error: "Nenhuma das APIs (RADAR/Receita) respondeu.",
      });
    }

    // textos padrão quando uma das APIs falha mesmo após retry
    const textoSemInfoRadar = radarFalhou ? "Sem informação" : "";
    const textoSemInfoReceita = receitaFalhou ? "Sem informação" : "";

    const dados = {
      // Campos de habilitação (RADAR)
      contribuinte: radar?.contribuinte || textoSemInfoRadar,
      situacao: radar?.situacao || textoSemInfoRadar,
      dataSituacao: radar?.dataSituacao || textoSemInfoRadar,
      submodalidade: radar?.submodalidade || textoSemInfoRadar,

      // Campos cadastrais (ReceitaWS)
      razaoSocial: receita?.razaoSocial || textoSemInfoReceita,
      nomeFantasia:
        receita && receita.nomeFantasia && receita.nomeFantasia.trim().length
          ? receita.nomeFantasia.trim()
          : receita
          ? "Sem nome fantasia"
          : "",
      municipio: receita?.municipio || "",
      uf: receita?.uf || "",
      dataConstituicao: receita?.dataConstituicao || "",
      regimeTributario: receita?.regimeTributario || "",
      dataOpcaoSimples: receita?.dataOpcaoSimples || "",
      capitalSocial: receita?.capitalSocial || "",
    };

    // 🔹 3) DECIDE SE VAI SALVAR NO BANCO
    let salvarNoBanco = true;
    if (!radar && receita && radarFalhou) {
      salvarNoBanco = false;
    }

    // marca como incompleto se:
    // - radar veio vazio (radarIncompleto)
    // - ou radar falhou
    // - ou receita falhou
    let flagDadosIncompletos = false;
    if (radarIncompleto || radarFalhou || receitaFalhou) {
      flagDadosIncompletos = true;
    }

    let dataConsultaResposta = new Date().toISOString().slice(0, 10);
    let linha = null;

    if (salvarNoBanco) {
      linha = await salvarConsulta(cnpj, dados, req.user);
      dataConsultaResposta = linha.data_consulta;

      // atualiza flag de dados incompletos
      await pool.query(
        "UPDATE consultas_radar SET dados_incompletos = $2 WHERE id = $1",
        [linha.id, flagDadosIncompletos]
      );

      console.log(
        "✔ Consulta salva/atualizada no banco:",
        linha.id,
        cnpj,
        "por",
        req.user?.nome || "desconhecido"
      );

      await registrarLogConsulta(
        usuarioId,
        cnpj,
        origem,
        true,
        radarFalhou || receitaFalhou
          ? "consulta salva (com partial/falha em uma das APIs, após retries)"
          : "consulta salva"
      );
    } else {
      console.log(
        "ℹ Consulta NÃO salva no banco (somente ReceitaWS, RADAR falhou):",
        cnpj
      );

      await registrarLogConsulta(
        usuarioId,
        cnpj,
        origem,
        true,
        "consulta parcial (somente ReceitaWS, não salva no banco)"
      );
    }

    return res.json({
      fromCache: false,
      dataConsulta: dataConsultaResposta,
      cnpj,
      ...dados,
    });
  } catch (err) {
    console.error("Erro /consulta-completa:", err);
    await registrarLogConsulta(
      usuarioId,
      normalizarCNPJ(req.query.cnpj),
      origem,
      false,
      err.message
    );
    return res.status(500).json({ error: "Erro interno em consulta-completa" });
  }
});

const TABELA_CONSULTAS = "radar_consultas";

app.get("/api/historico-exportacoes", authMiddleware, async (req, res) => {
  try {
    const { date, from, to } = req.query;

    let sql = `
        SELECT he.id,
               he.criado_em,
               he.filtro_tipo,
               he.data_inicio,
               he.data_fim,
               he.nome_arquivo,
               he.total_registros,
               u.nome AS usuario_nome
        FROM historico_exportacoes he
        JOIN usuarios u ON u.id = he.user_id
        WHERE 1=1
      `;
    const params = [];

    if (date) {
      params.push(date);
      sql += ` AND he.criado_em::date = $${params.length}`;
    } else if (from && to) {
      params.push(from);
      sql += ` AND he.criado_em::date >= $${params.length}`;
      params.push(to);
      sql += ` AND he.criado_em::date <= $${params.length}`;
    }

    sql += " ORDER BY he.criado_em DESC";

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("Erro GET /api/historico-exportacoes:", err);
    res.status(500).json({ error: "Erro ao listar histórico de exportações" });
  }
});

// cria um registro de histórico e já devolve os dados para gerar o Excel no front
app.post("/api/historico-exportacoes", authMiddleware, async (req, res) => {
  try {
    const user = req.user; // vem do authMiddleware
    const {
      filtro_tipo, // 'dia' ou 'intervalo'
      data_inicio, // 'YYYY-MM-DD'
      data_fim, // 'YYYY-MM-DD'
      nome_arquivo, // opcional
    } = req.body || {};

    if (!filtro_tipo || !data_inicio || !data_fim) {
      return res.status(400).json({ error: "Parâmetros inválidos." });
    }

    // Busca todos os registros desse período
    const paramsDados = [data_inicio, data_fim];
    const sqlDados = `
        SELECT *
        FROM ${TABELA_CONSULTAS}
        WHERE data_consulta::date BETWEEN $1 AND $2
        ORDER BY data_consulta ASC
      `;
    const { rows: dados } = await pool.query(sqlDados, paramsDados);

    // Salva o resumo do lote na tabela de histórico
    const paramsHist = [
      user.id,
      filtro_tipo,
      data_inicio,
      data_fim,
      nome_arquivo || null,
      dados.length,
    ];
    const sqlHist = `
        INSERT INTO historico_exportacoes
          (user_id, filtro_tipo, data_inicio, data_fim, nome_arquivo, total_registros)
        VALUES ($1,$2,$3,$4,$5,$6)
        RETURNING id, criado_em
      `;
    const { rows: histRows } = await pool.query(sqlHist, paramsHist);
    const lote = histRows[0];

    // devolve o ID do lote + os dados para o front gerar o Excel
    res.json({
      id_exportacao: lote.id,
      criado_em: lote.criado_em,
      total_registros: dados.length,
      dados,
    });
  } catch (err) {
    console.error("Erro POST /api/historico-exportacoes:", err);
    res.status(500).json({ error: "Erro ao criar histórico de exportação" });
  }
});

// DOWNLOAD de um lote antigo: refaz a consulta e devolve o XLSX pronto
app.get(
  "/api/historico-exportacoes/:id/download",
  authMiddleware,
  async (req, res) => {
    try {
      const { id } = req.params;

      const { rows } = await pool.query(
        `
        SELECT he.*, u.nome AS usuario_nome
        FROM historico_exportacoes he
        JOIN usuarios u ON u.id = he.user_id
        WHERE he.id = $1
      `,
        [id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Exportação não encontrada" });
      }

      const lote = rows[0];

      // busca novamente os dados originais pelo filtro salvo
      const paramsDados = [lote.data_inicio, lote.data_fim];
      const sqlDados = `
        SELECT *
        FROM ${TABELA_CONSULTAS}
        WHERE data_consulta::date BETWEEN $1 AND $2
        ORDER BY data_consulta ASC
      `;
      const { rows: dados } = await pool.query(sqlDados, paramsDados);

      // monta XLSX na hora
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(dados);
      XLSX.utils.book_append_sheet(wb, ws, "Dados");

      const wbout = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const nomeBase =
        lote.nome_arquivo ||
        `historico_${lote.data_inicio}_${lote.data_fim}`.replace(/-/g, "");

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${nomeBase}.xlsx"`
      );
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.send(wbout);
    } catch (err) {
      console.error("Erro GET /api/historico-exportacoes/:id/download:", err);
      res.status(500).json({ error: "Erro ao gerar download do histórico" });
    }
  }
);

// ================= HISTÓRICO (COM AUTH) =================

app.get("/historico/datas", authMiddleware, async (req, res) => {
  try {
    const sql = `
      SELECT data_consulta, COUNT(*) AS total
      FROM consultas_radar
      GROUP BY data_consulta
      ORDER BY data_consulta DESC;
    `;
    const { rows } = await pool.query(sql);
    return res.json(
      rows.map((r) => ({
        dataConsulta: r.data_consulta,
        total: Number(r.total),
      }))
    );
  } catch (err) {
    console.error("Erro /historico/datas:", err);
    return res.status(500).json({ error: "Erro ao listar datas do histórico" });
  }
});

app.get("/historico", authMiddleware, async (req, res) => {
  try {
    const { data, from, to, registrarExport } = req.query;
    const deveRegistrarExport = registrarExport === "1";

    let sql;
    let params;

    if (data) {
      sql = `
        SELECT *
        FROM consultas_radar
        WHERE data_consulta = $1
        ORDER BY cnpj;
      `;
      params = [data];
    } else if (from && to) {
      sql = `
        SELECT *
        FROM consultas_radar
        WHERE data_consulta BETWEEN $1 AND $2
        ORDER BY data_consulta, cnpj;
      `;
      params = [from, to];
    } else {
      return res.status(400).json({
        error:
          "Informe ?data=YYYY-MM-DD ou ?from=YYYY-MM-DD&to=YYYY-MM-DD para consultar o histórico.",
      });
    }

    const { rows } = await pool.query(sql, params);

    if (deveRegistrarExport && req.user && req.user.nome) {
      const nomeUsuario = req.user.nome;
      let updateSql;
      let updateParams;

      if (data) {
        updateSql = `
          UPDATE consultas_radar
          SET exportado_por = $1
          WHERE data_consulta = $2;
        `;
        updateParams = [nomeUsuario, data];
      } else {
        updateSql = `
          UPDATE consultas_radar
          SET exportado_por = $1
          WHERE data_consulta BETWEEN $2 AND $3;
        `;
        updateParams = [nomeUsuario, from, to];
      }

      await pool.query(updateSql, updateParams);
    }

    const resultado = rows.map((linha) => ({
      dataConsulta: linha.data_consulta,
      cnpj: linha.cnpj,
      contribuinte: linha.contribuinte || "",
      situacao: linha.situacao || "",
      dataSituacao: linha.data_situacao || "",
      submodalidade: linha.submodalidade || "",
      razaoSocial: linha.razao_social || "",
      nomeFantasia: linha.nome_fantasia || "",
      municipio: linha.municipio || "",
      uf: linha.uf || "",
      dataConstituicao: linha.data_constituicao || "",
      regimeTributario: linha.regime_tributario || "",
      dataOpcaoSimples: linha.data_opcao_simples || "",
      capitalSocial: linha.capital_social || "",
      exportadoPor: linha.exportado_por || "",
      consultadoPorId: linha.consultado_por_id || null,
      consultadoPorNome: linha.consultado_por_nome || "",
    }));

    return res.json(resultado);
  } catch (err) {
    console.error("Erro /historico:", err);
    return res.status(500).json({ error: "Erro ao consultar histórico" });
  }
});

// ================= CORRIGIR REGISTROS INCOMPLETOS (apenas ADMIN) =================
app.get(
  "/corrigir-erros",
  authMiddleware,
  authMiddlewareAdmin,
  async (req, res) => {
    try {
      const sql = `
        SELECT *
        FROM consultas_radar
        WHERE dados_incompletos = TRUE
        ORDER BY data_consulta DESC;
      `;
      const { rows } = await pool.query(sql);

      if (rows.length === 0) {
        return res.json({ message: "Nenhum registro incompleto encontrado." });
      }

      const corrigidos = [];

      for (const item of rows) {
        const receitaResult = await tentarComRetry(
          () => consultaReceitaWsAPI(item.cnpj),
          `ReceitaWS corrigir ${item.cnpj}`,
          10,
          900
        );

        if (!receitaResult.ok) {
          console.log("❌ Falha ao corrigir:", item.cnpj);
          continue;
        }

        const r = receitaResult.valor;

        await pool.query(
          `
          UPDATE consultas_radar
          SET
            razao_social = $2,
            nome_fantasia = $3,
            municipio = $4,
            uf = $5,
            data_constituicao = $6,
            regime_tributario = $7,
            data_opcao_simples = $8,
            capital_social = $9,
            dados_incompletos = FALSE,
            atualizado_em = NOW()
          WHERE id = $1
          `,
          [
            item.id,
            r.razaoSocial,
            r.nomeFantasia,
            r.municipio,
            r.uf,
            r.dataConstituicao,
            r.regimeTributario,
            r.dataOpcaoSimples,
            r.capitalSocial,
          ]
        );

        corrigidos.push(item.cnpj);
      }

      return res.json({
        message: "Correção concluída.",
        corrigidos,
      });
    } catch (err) {
      console.error("Erro /corrigir-erros:", err);
      return res.status(500).json({ error: "Erro ao corrigir registros." });
    }
  }
);

// ======================================================
//                 CHAMADOS TI – SELF SERVICE
// ======================================================

// ================== RESERVAS DE DIA (SELF-SERVICE) ==================

app.get(
  "/ti/reservas",
  authMiddleware,
  requireChamadosPermission,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const sql = `
        SELECT id, data, periodo, motivo, criado_em
        FROM ti_reservas
        WHERE usuario_id = $1
        ORDER BY data DESC, criado_em DESC;
      `;

      const { rows } = await pool.query(sql, [userId]);

      const lista = rows.map((r) => ({
        id: r.id,
        data: r.data, // YYYY-MM-DD
        periodo: r.periodo, // manha, tarde, dia_todo
        motivo: r.motivo || "",
        criado_em: r.criado_em,
      }));

      return res.json(lista);
    } catch (err) {
      console.error("Erro GET /ti/reservas:", err);
      return res.status(500).json({ error: "Erro ao listar reservas." });
    }
  }
);

app.post(
  "/ti/reservas",
  authMiddleware,
  requireChamadosPermission,
  async (req, res) => {
    try {
      const { data, periodo, motivo } = req.body || {};
      const userId = req.user.id;

      if (!data) {
        return res
          .status(400)
          .json({ error: "Data da reserva é obrigatória." });
      }

      const periodoLimpo = (periodo || "dia_todo").toLowerCase();
      const allowedPeriodos = ["manha", "tarde", "dia_todo"];

      if (!allowedPeriodos.includes(periodoLimpo)) {
        return res.status(400).json({ error: "Período inválido." });
      }

      const sql = `
        INSERT INTO ti_reservas (usuario_id, data, periodo, motivo)
        VALUES ($1, $2, $3, $4)
        RETURNING id, usuario_id, data, periodo, motivo, criado_em;
      `;

      try {
        const { rows } = await pool.query(sql, [
          userId,
          data,
          periodoLimpo,
          motivo || "",
        ]);

        const r = rows[0];

        return res.status(201).json({
          id: r.id,
          data: r.data,
          periodo: r.periodo,
          motivo: r.motivo || "",
          criado_em: r.criado_em,
        });
      } catch (err) {
        // conflito com índice único (já existe reserva para esse dia/período)
        if (err.code === "23505") {
          return res.status(400).json({
            error:
              "Você já possui uma reserva para essa data e período. Altere ou exclua a reserva existente.",
          });
        }
        throw err;
      }
    } catch (err) {
      console.error("Erro POST /ti/reservas:", err);
      return res.status(500).json({ error: "Erro ao registrar reserva." });
    }
  }
);

// Criar chamado TI (Self-Service)
app.post(
  "/ti/chamados",
  authMiddleware,
  requireChamadosPermission,
  upload.array("anexos", 5), // <= NOME DO CAMPO DO FORM
  async (req, res) => {
    try {
      const { titulo, descricao, tipo, categoria, urgencia } = req.body || {};

      if (!titulo || !titulo.trim()) {
        return res
          .status(400)
          .json({ error: "Título do chamado é obrigatório." });
      }

      const userId = req.user.id;
      const userNome = req.user.nome || "Usuário";

      const tipoFinal = (tipo || "incident").toLowerCase();
      const categoriaFinal = categoria || "-----";
      const urgenciaFinal = (urgencia || "medium").toLowerCase();

      const sql = `
        INSERT INTO chamados_ti (
          titulo,
          descricao,
          tipo,
          categoria,
          urgencia,
          status,
          solicitante_id,
          solicitante_nome
        )
        VALUES ($1, $2, $3, $4, $5, 'new', $6, $7)
        RETURNING
          id,
          titulo,
          descricao,
          tipo,
          categoria,
          urgencia,
          status,
          solicitante_id,
          solicitante_nome,
          criado_em,
          atualizado_em,
          fechado_em;
      `;

      const { rows } = await pool.query(sql, [
        titulo.trim(),
        descricao || "",
        tipoFinal,
        categoriaFinal,
        urgenciaFinal,
        userId,
        userNome,
      ]);

      const chamado = rows[0];

      // registra atividade de criação
      await pool.query(
        `
        INSERT INTO chamados_ti_atividade
          (chamado_id, tipo, descricao, criado_por_id, criado_por_nome)
        VALUES
          ($1, 'create', $2, $3, $4);
      `,
        [chamado.id, "Chamado criado pelo usuário.", userId, userNome]
      );

      // ========= SALVA ANEXOS =========
      if (Array.isArray(req.files) && req.files.length > 0) {
        for (const file of req.files) {
          await pool.query(
            `
            INSERT INTO chamados_ti_arquivos
              (chamado_id, nome_original, nome_arquivo, mimetype, tamanho)
            VALUES ($1, $2, $3, $4, $5);
          `,
            [
              chamado.id,
              file.originalname,
              file.filename,
              file.mimetype,
              file.size,
            ]
          );
        }
      }

      return res.status(201).json({
        ...chamado,
        numero: `#${chamado.id}`,
      });
    } catch (err) {
      console.error("Erro POST /ti/chamados:", err);
      return res.status(500).json({ error: "Erro ao criar chamado de TI." });
    }
  }
);

// Listar chamados do próprio usuário
app.get(
  "/ti/chamados",
  authMiddleware,
  requireChamadosPermission,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const sql = `
        SELECT
          id,
          titulo,
          descricao,
          tipo,
          categoria,
          urgencia,
          status,
          solicitante_nome,
          criado_em,
          atualizado_em,
          fechado_em
        FROM chamados_ti
        WHERE solicitante_id = $1
        ORDER BY criado_em DESC;
      `;

      const { rows } = await pool.query(sql, [userId]);

      const lista = rows.map((r) => ({
        id: r.id,
        numero: `#${r.id}`,
        titulo: r.titulo,
        descricao: r.descricao,
        tipo: r.tipo,
        categoria: r.categoria,
        urgencia: r.urgencia,
        status: r.status,
        solicitante_nome: r.solicitante_nome,
        criado_em: r.criado_em,
        atualizado_em: r.atualizado_em,
        fechado_em: r.fechado_em,
      }));

      return res.json(lista);
    } catch (err) {
      console.error("Erro GET /ti/chamados:", err);
      return res.status(500).json({ error: "Erro ao listar chamados." });
    }
  }
);

// Resumo de status para o usuário (cards da tela Self-Service)
app.get(
  "/ti/chamados/resumo",
  authMiddleware,
  requireChamadosPermission,
  async (req, res) => {
    try {
      const userId = req.user.id;

      const sql = `
        SELECT status, COUNT(*) AS total
        FROM chamados_ti
        WHERE solicitante_id = $1
        GROUP BY status;
      `;

      const { rows } = await pool.query(sql, [userId]);

      const base = {
        new: 0,
        processing_assigned: 0,
        processing_planned: 0,
        pending: 0,
        solved: 0,
        closed: 0,
        deleted: 0,
      };

      rows.forEach((r) => {
        const status = r.status;
        if (base.hasOwnProperty(status)) {
          base[status] = Number(r.total);
        }
      });

      return res.json(base);
    } catch (err) {
      console.error("Erro GET /ti/chamados/resumo:", err);
      return res.status(500).json({ error: "Erro ao obter resumo." });
    }
  }
);

// ======================================================
//                     MASTER TI – PAINEL
// ======================================================

// Métricas do dashboard (cards grandes)
app.get(
  "/ti/master/resumo",
  authMiddleware,
  requireMasterTiPermission,
  async (req, res) => {
    try {
      const sql = `
        SELECT status, COUNT(*) AS total
        FROM chamados_ti
        GROUP BY status;
      `;
      const { rows } = await pool.query(sql);

      let abertos = 0;
      let emAndamento = 0;
      let pendentesAprovacao = 0;

      rows.forEach((r) => {
        const s = r.status;
        const total = Number(r.total);
        if (s === "new") abertos += total;
        if (s === "processing_assigned" || s === "processing_planned") {
          emAndamento += total;
        }
        if (s === "pending") pendentesAprovacao += total;
      });

      const sqlHoje = `
        SELECT COUNT(*) AS total
        FROM chamados_ti
        WHERE status = 'solved'
          AND DATE(fechado_em) = CURRENT_DATE;
      `;
      const { rows: rowsHoje } = await pool.query(sqlHoje);
      const concluidosHoje = Number(rowsHoje[0]?.total || 0);

      return res.json({
        abertos,
        emAndamento,
        pendentesAprovacao,
        concluidosHoje,
      });
    } catch (err) {
      console.error("Erro GET /ti/master/resumo:", err);
      return res.status(500).json({ error: "Erro ao obter métricas." });
    }
  }
);

// Tabela de chamados recentes (lado esquerdo do Master)
app.get(
  "/ti/master/chamados",
  authMiddleware,
  requireMasterTiPermission,
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);

      const sql = `
        SELECT
          id,
          titulo,
          solicitante_nome,
          categoria,
          status,
          criado_em
        FROM chamados_ti
        ORDER BY criado_em DESC
        LIMIT $1;
      `;

      const { rows } = await pool.query(sql, [limit]);

      const lista = rows.map((r) => ({
        id: r.id,
        numero: `#${r.id}`,
        titulo: r.titulo,
        solicitante_nome: r.solicitante_nome,
        categoria: r.categoria,
        status: r.status,
        criado_em: r.criado_em,
      }));

      return res.json(lista);
    } catch (err) {
      console.error("Erro GET /ti/master/chamados:", err);
      return res
        .status(500)
        .json({ error: "Erro ao listar chamados recentes (Master)." });
    }
  }
);

// Detalhes de um chamado + histórico
app.get(
  "/ti/master/chamados/:id",
  authMiddleware,
  requireMasterTiPermission,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) {
        return res.status(400).json({ error: "ID de chamado inválido." });
      }

      const sqlChamado = `
        SELECT id, titulo, descricao, tipo, categoria, urgencia, status,
               solicitante_id, solicitante_nome,
               responsavel_id, responsavel_nome,
               criado_em, atualizado_em, fechado_em
        FROM chamados_ti
        WHERE id = $1;
      `;

      const { rows: rowsChamado } = await pool.query(sqlChamado, [id]);
      const chamado = rowsChamado[0];

      if (!chamado) {
        return res.status(404).json({ error: "Chamado não encontrado." });
      }

      const sqlAtividades = `
        SELECT id, chamado_id, tipo, descricao,
               criado_por_id, criado_por_nome, criado_em
        FROM chamados_ti_atividade
        WHERE chamado_id = $1
        ORDER BY criado_em ASC;
      `;

      const { rows: rowsAtividades } = await pool.query(sqlAtividades, [id]);

      const atividades = rowsAtividades.map((a) => ({
        id: a.id,
        tipo: a.tipo,
        descricao: a.descricao,
        criadoPorId: a.criado_por_id,
        criadoPorNome: a.criado_por_nome,
        criadoEm: a.criado_em,
      }));

      // ====== NOVO: ARQUIVOS DO CHAMADO ======
      const sqlArquivos = `
        SELECT id, nome_original, nome_arquivo, mimetype, tamanho, criado_em
        FROM chamados_ti_arquivos
        WHERE chamado_id = $1
        ORDER BY criado_em ASC;
      `;
      const { rows: rowsArquivos } = await pool.query(sqlArquivos, [id]);

      const arquivos = rowsArquivos.map((f) => ({
        id: f.id,
        nomeOriginal: f.nome_original,
        url: `/uploads/${f.nome_arquivo}`,
        mimetype: f.mimetype,
        tamanho: f.tamanho,
        criadoEm: f.criado_em,
      }));

      return res.json({
        chamado: {
          ...chamado,
          numero: `#${chamado.id}`,
        },
        atividades,
        arquivos, // <= devolve para o front
      });
    } catch (err) {
      console.error("Erro GET /ti/master/chamados/:id:", err);
      return res.status(500).json({ error: "Erro ao obter detalhes." });
    }
  }
);

// Adicionar comentário no chamado
app.post(
  "/ti/master/chamados/:id/comentario",
  authMiddleware,
  requireMasterTiPermission,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) {
        return res.status(400).json({ error: "ID de chamado inválido." });
      }

      const { texto } = req.body || {};
      if (!texto || !texto.trim()) {
        return res
          .status(400)
          .json({ error: "Texto do comentário é obrigatório." });
      }

      const userId = req.user.id;
      const userNome = req.user.nome || "Master TI";

      const { rows: rowsChk } = await pool.query(
        "SELECT id FROM chamados_ti WHERE id = $1",
        [id]
      );
      if (!rowsChk[0]) {
        return res.status(404).json({ error: "Chamado não encontrado." });
      }

      const sqlInsert = `
        INSERT INTO chamados_ti_atividade
          (chamado_id, tipo, descricao, criado_por_id, criado_por_nome)
        VALUES ($1, 'comment', $2, $3, $4)
        RETURNING id, chamado_id, tipo, descricao,
                  criado_por_id, criado_por_nome, criado_em;
      `;

      const { rows } = await pool.query(sqlInsert, [
        id,
        texto.trim(),
        userId,
        userNome,
      ]);

      const atividade = rows[0];

      return res.status(201).json({
        id: atividade.id,
        chamadoId: atividade.chamado_id,
        tipo: atividade.tipo,
        descricao: atividade.descricao,
        criadoPorId: atividade.criado_por_id,
        criadoPorNome: atividade.criado_por_nome,
        criadoEm: atividade.criado_em,
      });
    } catch (err) {
      console.error("Erro POST /ti/master/chamados/:id/comentario:", err);
      return res.status(500).json({ error: "Erro ao adicionar comentário." });
    }
  }
);

// Atividade recente (timeline lado direito do Master)
app.get(
  "/ti/master/atividade",
  authMiddleware,
  requireMasterTiPermission,
  async (req, res) => {
    try {
      const sql = `
        SELECT
          a.id,
          a.chamado_id,
          c.titulo AS chamado_titulo,
          a.tipo,
          a.descricao,
          a.criado_por_nome,
          a.criado_em
        FROM chamados_ti_atividade a
        LEFT JOIN chamados_ti c ON c.id = a.chamado_id
        ORDER BY a.criado_em DESC
        LIMIT 10;
      `;

      const { rows } = await pool.query(sql);

      const lista = rows.map((r) => ({
        id: r.id,
        chamadoId: r.chamado_id,
        numero: r.chamado_id ? `#${r.chamado_id}` : null,
        tituloChamado: r.chamado_titulo || "",
        tipo: r.tipo,
        descricao: r.descricao,
        criadoPorNome: r.criado_por_nome,
        criadoEm: r.criado_em,
      }));

      return res.json(lista);
    } catch (err) {
      console.error("Erro GET /ti/master/atividade:", err);
      return res
        .status(500)
        .json({ error: "Erro ao listar atividade recente." });
    }
  }
);

// Alterar status de um chamado (Master TI)
app.put(
  "/ti/master/chamados/:id/status",
  authMiddleware,
  requireMasterTiPermission,
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) {
        return res.status(400).json({ error: "ID de chamado inválido." });
      }

      const { status } = req.body || {};
      const allowed = [
        "new",
        "processing_assigned",
        "processing_planned",
        "pending",
        "solved",
        "closed",
        "deleted",
      ];

      if (!allowed.includes(status)) {
        return res.status(400).json({ error: "Status inválido." });
      }

      const userId = req.user.id;
      const userNome = req.user.nome || "Master TI";

      const sql = `
        UPDATE chamados_ti
        SET
          status = $1::varchar,
          responsavel_id = $2::bigint,
          responsavel_nome = $3::varchar,
          atualizado_em = NOW(),
          fechado_em = CASE
            WHEN $1::varchar IN ('solved', 'closed') THEN NOW()
            ELSE fechado_em
          END
        WHERE id = $4::bigint
        RETURNING
          id,
          titulo,
          solicitante_nome,
          categoria,
          status,
          criado_em,
          atualizado_em,
          fechado_em;
      `;

      const { rows } = await pool.query(sql, [status, userId, userNome, id]);
      const chamado = rows[0];

      if (!chamado) {
        return res.status(404).json({ error: "Chamado não encontrado." });
      }

      await pool.query(
        `
        INSERT INTO chamados_ti_atividade
          (chamado_id, tipo, descricao, criado_por_id, criado_por_nome)
        VALUES
          ($1, 'status_change', $2, $3, $4);
      `,
        [
          id,
          `Status alterado para "${status}" por ${userNome}`,
          userId,
          userNome,
        ]
      );

      return res.json({
        ...chamado,
        numero: `#${chamado.id}`,
      });
    } catch (err) {
      console.error("Erro PUT /ti/master/chamados/:id/status:", err);
      return res.status(500).json({ error: "Erro ao alterar status." });
    }
  }
);

// ========== SOBE O SERVIDOR ==========
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erro ao inicializar DB:", err);
    process.exit(1);
  });
