// ====== CONFIG BACKEND (LOCAL x PRODUÇÃO) ======
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const API_BASE = isLocalHost
  ? "http://localhost:3000"
  : "https://testesssss-production.up.railway.app";

// ====== ELEMENTOS ======
const inputNome = document.querySelector("#usuario-nome");
const inputEmail = document.querySelector("#usuario-email");
const inputSenha = document.querySelector("#usuario-senha");
const selectPerfil = document.querySelector("#usuario-perfil");
const toggleAtivo = document.querySelector("#usuario-ativo");
const togglePodeLote = document.querySelector("#usuario-pode-lote");
const btnSalvar = document.querySelector("#btn-salvar-usuario");
const spanErro = document.querySelector("#msg-erro-usuario");

// permissões (versão simples)
const togglePermRadar = document.querySelector("#usuario-perm-radar");
const togglePermChamados = document.querySelector("#usuario-perm-chamados");
const togglePermMasterTi = document.querySelector("#usuario-perm-masterti");
const togglePermAdmin = document.querySelector("#usuario-perm-admin");

const tbodyUsuarios = document.querySelector("#lista-usuarios tbody");
const campoBusca = document.querySelector("#busca-usuarios");

let usuariosCache = [];
let usuarioEditandoId = null;

// ====== AUTENTICAÇÃO ======
function getToken() {
  return (
    localStorage.getItem("authToken") ||
    localStorage.getItem("radar_token") ||
    localStorage.getItem("token") ||
    ""
  );
}

function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = "login.html";
  }
}

requireAuth();

// ====== HELPERS UI ======
function showErro(msg) {
  if (!spanErro) return;
  spanErro.textContent = msg || "";
  spanErro.style.visibility = msg ? "visible" : "hidden";
}

function limparFormulario() {
  usuarioEditandoId = null;
  if (inputNome) inputNome.value = "";
  if (inputEmail) inputEmail.value = "";
  if (inputSenha) inputSenha.value = "";
  if (selectPerfil) selectPerfil.value = "user"; // padrão
  if (toggleAtivo) toggleAtivo.checked = true;
  if (togglePodeLote) togglePodeLote.checked = true;

  // padrão: RADAR e Chamados ligados, resto desligado (igual admin.html)
  if (togglePermRadar) togglePermRadar.checked = true;
  if (togglePermChamados) togglePermChamados.checked = true;
  if (togglePermMasterTi) togglePermMasterTi.checked = false;
  if (togglePermAdmin) togglePermAdmin.checked = false;

  showErro("");
}

// ====== CHAMADAS API ======
async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const resp = await fetch(API_BASE + path, {
    ...options,
    headers,
  });

  let data = null;
  try {
    data = await resp.json();
  } catch (e) {
    data = null;
  }

  if (!resp.ok) {
    const msg = (data && data.error) || `Erro HTTP ${resp.status}`;
    throw new Error(msg);
  }

  return data;
}

// ====== LISTAR USUÁRIOS ======
async function carregarUsuarios() {
  try {
    showErro("");
    const data = await apiFetch("/admin/usuarios");
    usuariosCache = Array.isArray(data) ? data : [];
    renderizarUsuarios();
  } catch (err) {
    console.error("Erro ao carregar usuários:", err);
    showErro(err.message || "Erro ao carregar usuários.");
  }
}

function renderizarUsuarios() {
  if (!tbodyUsuarios) return;
  tbodyUsuarios.innerHTML = "";

  const filtro = (campoBusca?.value || "").toLowerCase().trim();

  const listaFiltrada = usuariosCache.filter((u) => {
    if (!filtro) return true;
    return (
      String(u.nome || "")
        .toLowerCase()
        .includes(filtro) ||
      String(u.email || "")
        .toLowerCase()
        .includes(filtro)
    );
  });

  if (!listaFiltrada.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "Nenhum usuário cadastrado.";
    tr.appendChild(td);
    tbodyUsuarios.appendChild(tr);
    return;
  }

  for (const u of listaFiltrada) {
    const tr = document.createElement("tr");

    const tdNome = document.createElement("td");
    tdNome.textContent = u.nome || "";
    tr.appendChild(tdNome);

    const tdEmail = document.createElement("td");
    tdEmail.textContent = u.email || "";
    tr.appendChild(tdEmail);

    const tdPerfil = document.createElement("td");
    tdPerfil.textContent = u.role === "admin" ? "Administrador" : "Usuário";
    tr.appendChild(tdPerfil);

    const tdLote = document.createElement("td");
    tdLote.textContent = u.pode_lote ? "Sim" : "Não";
    tr.appendChild(tdLote);

    const tdStatus = document.createElement("td");
    tdStatus.textContent = u.ativo ? "Ativo" : "Inativo";
    tr.appendChild(tdStatus);

    const tdAcoes = document.createElement("td");
    const btnEditar = document.createElement("button");
    btnEditar.textContent = "Editar";
    btnEditar.className = "btn-acao";
    btnEditar.onclick = () => preencherFormularioParaEdicao(u);

    const btnDesativar = document.createElement("button");
    btnDesativar.textContent = u.ativo ? "Desativar" : "Reativar";
    btnDesativar.className = "btn-acao";
    btnDesativar.onclick = () => toggleAtivoUsuario(u);

    tdAcoes.appendChild(btnEditar);
    tdAcoes.appendChild(btnDesativar);
    tr.appendChild(tdAcoes);

    tbodyUsuarios.appendChild(tr);
  }
}

// ====== FORM ======
function preencherFormularioParaEdicao(u) {
  usuarioEditandoId = u.id;
  if (inputNome) inputNome.value = u.nome || "";
  if (inputEmail) inputEmail.value = u.email || "";
  if (inputSenha) inputSenha.value = "";
  if (selectPerfil) selectPerfil.value = u.role === "admin" ? "admin" : "user";
  if (toggleAtivo) toggleAtivo.checked = !!u.ativo;
  if (togglePodeLote) togglePodeLote.checked = !!u.pode_lote;

  const perms = u.permissions || {};
  if (togglePermRadar) togglePermRadar.checked = !!perms.radar;
  if (togglePermChamados) togglePermChamados.checked = !!perms.chamados;
  if (togglePermMasterTi)
    togglePermMasterTi.checked = !!(perms.masterTi || perms.master_ti);
  if (togglePermAdmin)
    togglePermAdmin.checked = !!(perms.adminUsuarios || perms.admin);

  showErro("");
}

async function salvarUsuario(e) {
  e?.preventDefault?.();
  try {
    showErro("");

    const permissions = {
      radar: !!(togglePermRadar && togglePermRadar.checked),
      chamados: !!(togglePermChamados && togglePermChamados.checked),
      masterTi: !!(togglePermMasterTi && togglePermMasterTi.checked),
      adminUsuarios: !!(togglePermAdmin && togglePermAdmin.checked),
      // demais módulos não existem neste form simples, então gravamos como false
      reservas: false,
      financeiro: false,
      estoque: false,
      relatorios: false,
      integracoes: false,
      monitoramento: false,
    };

    const payload = {
      nome: (inputNome && inputNome.value.trim()) || "",
      email: (inputEmail && inputEmail.value.trim()) || "",
      senha: (inputSenha && inputSenha.value.trim()) || "",
      role: selectPerfil ? selectPerfil.value : "user",
      ativo: toggleAtivo ? toggleAtivo.checked : true,
      pode_lote: togglePodeLote ? togglePodeLote.checked : true,
      permissions,
    };

    if (!payload.nome || !payload.email || !payload.senha) {
      showErro("Nome, e-mail e senha são obrigatórios.");
      return;
    }

    if (usuarioEditandoId) {
      await apiFetch(`/admin/usuarios/${usuarioEditandoId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      await apiFetch("/admin/usuarios", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }

    await carregarUsuarios();
    limparFormulario();
  } catch (err) {
    console.error("Erro ao salvar usuário:", err);
    showErro(err.message || "Erro inesperado ao salvar usuário.");
  }
}

async function toggleAtivoUsuario(u) {
  try {
    await apiFetch(`/admin/usuarios/${u.id}`, {
      method: "PUT",
      body: JSON.stringify({ ativo: !u.ativo }),
    });
    await carregarUsuarios();
  } catch (err) {
    console.error("Erro ao alterar status:", err);
    showErro(err.message || "Erro ao alterar status do usuário.");
  }
}

// ====== EVENTOS ======
if (btnSalvar) {
  btnSalvar.addEventListener("click", salvarUsuario);
}
if (campoBusca) {
  campoBusca.addEventListener("input", () => renderizarUsuarios());
}

// carrega tudo ao abrir a página
carregarUsuarios().catch((err) => {
  console.error(err);
  showErro("Erro ao carregar usuários.");
});
