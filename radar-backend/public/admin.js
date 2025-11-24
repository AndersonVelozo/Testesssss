// ======================= CONFIG / AUTH =========================

const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const BACKEND_BASE_URL = isLocalHost
  ? "http://localhost:3000"
  : "https://testesssss-production.up.railway.app";

function getToken() {
  return (
    localStorage.getItem("radar_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}

function decodeJwtPayload(token) {
  try {
    const [, payloadBase64] = token.split(".");
    if (!payloadBase64) return {};
    const normalized = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    return JSON.parse(json);
  } catch (err) {
    console.error("Erro ao decodificar token:", err);
    return {};
  }
}

function getCurrentUser() {
  const token = getToken();
  if (!token) return null;

  const payload = decodeJwtPayload(token);

  return {
    ...payload,
    nome: payload.nome || payload.name || "",
    role: payload.role || "user",
    permissions: payload.permissions || {},
  };
}

function gerarAvatarInicial(nome) {
  if (!nome || !nome.length) return "A";
  return nome.trim()[0].toUpperCase();
}

// ======================= ELEMENTOS BÁSICOS =====================

const adminUserNameEl = document.getElementById("adminUserName");
const adminUserRoleEl = document.getElementById("adminUserRole");
const adminAvatarEl = document.getElementById("adminAvatar");
const themeToggle = document.getElementById("themeToggle");
const logoutBtn = document.getElementById("logoutBtn");

// Form
const userForm = document.getElementById("userForm");
const userIdInput = document.getElementById("userId");
const nomeInput = document.getElementById("nome");
const emailInput = document.getElementById("email");
const senhaInput = document.getElementById("senha");
const roleSelect = document.getElementById("role");
const ativoCheckbox = document.getElementById("ativo");
const podeLoteCheckbox = document.getElementById("podeLote");
const salvarBtn = document.getElementById("salvarBtn");
const limparFormBtn = document.getElementById("limparFormBtn");
const formMsg = document.getElementById("formMsg");

// Permissões (VISUAIS + as que existem no banco)
const permRadarCheckbox = document.getElementById("permRadar");
const permChamadosCheckbox = document.getElementById("permChamados");
const permChatBotCheckbox = document.getElementById("permChatBot");
const permReservasCheckbox = document.getElementById("permReservas");
const permMasterTiCheckbox = document.getElementById("permMasterTi");
const permAdminCheckbox = document.getElementById("permAdmin");
const permFinanceiroCheckbox = document.getElementById("permFinanceiro");
const permEstoqueCheckbox = document.getElementById("permEstoque");
const permRelatoriosCheckbox = document.getElementById("permRelatorios");
const permIntegracoesCheckbox = document.getElementById("permIntegracoes");
const permMonitoramentoCheckbox = document.getElementById("permMonitoramento");

// Tabela
const usersTableBody = document.querySelector("#usersTable tbody");
const paginationEl = document.getElementById("paginacaoUsuarios");
const buscaUsuarioInput = document.getElementById("buscaUsuario");

// Select customizado de perfil
const selectRole = document.getElementById("selectRole");
const selectDisplay = selectRole.querySelector(".custom-select-display");
const selectList = selectRole.querySelector(".custom-select-list");
const selectText = document.getElementById("selectRoleText");
const realSelect = document.getElementById("role");

let usuarios = [];
let paginaAtual = 1;
const porPagina = 10;

// ======================= PROTEÇÃO DE ROTA ======================

(function protegerRotaAdmin() {
  const token = getToken();
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  const user = getCurrentUser();
  const roleLS = localStorage.getItem("usuarioRole") || "";

  const isAdminFromToken =
    user && (user.role === "admin" || !!user.permissions?.admin);
  const isAdminFromLS = roleLS === "admin";

  const isAdmin = isAdminFromToken || isAdminFromLS;

  if (!isAdmin) {
    alert("Acesso restrito ao administrador do sistema.");
    window.location.href = "home.html";
    return;
  }

  const nome =
    (user && user.nome) ||
    localStorage.getItem("usuarioNome") ||
    "Administrador";
  const role = (user && user.role) || roleLS || "admin";

  adminUserNameEl.textContent = nome;
  adminUserRoleEl.textContent = role;
  adminAvatarEl.textContent = gerarAvatarInicial(nome);
})();

// ======================= TEMA DARK/LIGHT =======================

if (!localStorage.getItem("adminTheme")) {
  localStorage.setItem("adminTheme", "dark");
}

function aplicarTema() {
  const tema = localStorage.getItem("adminTheme");

  if (tema === "light") {
    document.body.classList.add("light-theme");
    themeToggle.textContent = "☀️";
  } else {
    document.body.classList.remove("light-theme");
    themeToggle.textContent = "🌙";
  }
}

aplicarTema();

themeToggle.addEventListener("click", () => {
  const atual = localStorage.getItem("adminTheme");
  const novo = atual === "light" ? "dark" : "light";
  localStorage.setItem("adminTheme", novo);
  aplicarTema();
});

// ======================= LOGOUT ===============================

logoutBtn.onclick = () => {
  localStorage.clear();
  window.location.href = "login.html";
};

// ======================= UI HELPERS ===========================

function setFormMessage(msg, err = false) {
  formMsg.textContent = msg || "";
  formMsg.style.color = err ? "#fca5a5" : "#9ca3af";
}

function limparFormulario() {
  userIdInput.value = "";
  nomeInput.value = "";
  emailInput.value = "";
  senhaInput.value = "";
  roleSelect.value = "user";

  // Status padrão: usuário ativo, porém sem permissões
  ativoCheckbox.checked = true;
  podeLoteCheckbox.checked = false;

  // ✅ Padrão para NOVO usuário: NENHUMA permissão marcada
  permRadarCheckbox.checked = false;
  permChamadosCheckbox.checked = false;
  permChatBotCheckbox.checked = false;
  permReservasCheckbox.checked = false;
  permMasterTiCheckbox.checked = false;
  permAdminCheckbox.checked = false;
  permFinanceiroCheckbox.checked = false;
  permEstoqueCheckbox.checked = false;
  permRelatoriosCheckbox.checked = false;
  permIntegracoesCheckbox.checked = false;
  permMonitoramentoCheckbox.checked = false;

  salvarBtn.textContent = "💾 Salvar";
  setFormMessage("");

  if (selectText) selectText.textContent = "Usuário";
}

limparFormBtn.addEventListener("click", limparFormulario);

// ======================= PAGINAÇÃO ============================

function paginar(array, page, perPage) {
  const start = (page - 1) * perPage;
  return array.slice(start, start + perPage);
}

function renderizarPaginacao(total) {
  const paginas = Math.ceil(total / porPagina);
  paginationEl.innerHTML = "";

  if (paginas <= 1) return;

  for (let p = 1; p <= paginas; p++) {
    const btn = document.createElement("button");
    btn.textContent = p;
    btn.className = "btn-secondary btn-sm";

    if (p === paginaAtual) {
      btn.classList.add("page-active");
    }

    btn.onclick = () => {
      paginaAtual = p;
      renderizarUsuarios();
    };

    paginationEl.appendChild(btn);
  }
}

// ======================= RENDER USUÁRIOS ======================

function renderizarUsuarios() {
  usersTableBody.innerHTML = "";

  if (!usuarios.length) {
    usersTableBody.innerHTML = `
      <tr class="no-data-row">
        <td colspan="6" class="no-data">Nenhum usuário cadastrado.</td>
      </tr>`;
    return;
  }

  const listaPagina = paginar(usuarios, paginaAtual, porPagina);
  renderizarPaginacao(usuarios.length);

  listaPagina.forEach((u) => {
    const tr = document.createElement("tr");
    tr.dataset.nome = (u.nome || "").toLowerCase();
    tr.dataset.email = (u.email || "").toLowerCase();

    tr.innerHTML = `
      <td>${u.nome || ""}</td>
      <td>${u.email || ""}</td>

      <td>
        <span class="badge ${
          u.role === "admin" ? "badge-admin" : "badge-user"
        }">
          ${u.role}
        </span>
      </td>

      <td>
        <label class="toggle toggle-table">
          <input type="checkbox" class="toggle-lote" data-id="${u.id}" ${
      u.pode_lote ? "checked" : ""
    }>
          <span class="toggle-track">
            <span class="toggle-thumb"></span>
          </span>
        </label>
      </td>

      <td>
        <span class="badge ${u.ativo ? "badge-ativo" : "badge-inativo"}">
          ${u.ativo ? "Ativo" : "Inativo"}
        </span>
      </td>

      <td>
        <div class="admin-actions">
          <button class="btn-secondary btn-sm edit-user" data-id="${
            u.id
          }">Editar</button>
          <button class="btn-secondary btn-sm delete-user" data-id="${
            u.id
          }">Excluir</button>
        </div>
      </td>
    `;

    usersTableBody.appendChild(tr);
  });
}

// ======================= BUSCA NA TABELA ======================

buscaUsuarioInput.addEventListener("input", (e) => {
  const termo = e.target.value.toLowerCase();

  document.querySelectorAll("#usersTable tbody tr").forEach((linha) => {
    const nome = linha.dataset.nome || "";
    const email = linha.dataset.email || "";

    linha.style.display =
      nome.includes(termo) || email.includes(termo) ? "" : "none";
  });
});

// ======================= CARREGAR USUÁRIOS ====================

async function carregarUsuarios() {
  const token = getToken();

  if (!token) {
    alert("Sessão expirada. Faça login novamente.");
    window.location.href = "login.html";
    return;
  }

  try {
    const resp = await fetch(`${BACKEND_BASE_URL}/admin/usuarios`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(data.error || "Erro ao carregar usuários");
    }

    usuarios = Array.isArray(data) ? data : [];
    paginaAtual = 1;
    renderizarUsuarios();
    setFormMessage("");
  } catch (e) {
    console.error("Falha ao carregar usuários:", e);
    setFormMessage("Erro ao carregar usuários.", true);
    usuarios = [];
    renderizarUsuarios();
  }
}

// ======================= SALVAR USUÁRIO =======================

userForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = userIdInput.value || null;
  const nome = nomeInput.value.trim();
  const email = emailInput.value.trim();
  const senha = senhaInput.value.trim();

  if (!nome || !email) {
    setFormMessage("Nome e e-mail são obrigatórios.", true);
    return;
  }

  if (!id && !senha) {
    setFormMessage("Senha obrigatória para novo usuário.", true);
    return;
  }

  // Somente esses campos hoje têm coluna no banco:
  const payload = {
    nome,
    email,
    role: roleSelect.value,
    ativo: !!ativoCheckbox.checked,
    pode_lote: !!podeLoteCheckbox.checked,
    can_radar: !!permRadarCheckbox.checked,
    can_chamados: !!permChamadosCheckbox.checked,
    can_chatbot: !!permChatBotCheckbox.checked,
    can_admin: !!permAdminCheckbox.checked,
    can_master_ti: !!permMasterTiCheckbox.checked,

    // Os de baixo são VISUAIS por enquanto (sem coluna).
    // Já mando no payload para ficar pronto para o futuro:
    can_reservas: !!permReservasCheckbox.checked,
    can_financeiro: !!permFinanceiroCheckbox.checked,
    can_estoque: !!permEstoqueCheckbox.checked,
    can_relatorios: !!permRelatoriosCheckbox.checked,
    can_integracoes: !!permIntegracoesCheckbox.checked,
    can_monitoramento: !!permMonitoramentoCheckbox.checked,
  };

  if (senha) payload.senha = senha;

  console.log("Payload usuário (salvar):", payload);

  salvarBtn.disabled = true;
  setFormMessage("Salvando usuário...");

  try {
    const url = id
      ? `${BACKEND_BASE_URL}/admin/usuarios/${id}`
      : `${BACKEND_BASE_URL}/admin/usuarios`;

    const method = id ? "PUT" : "POST";

    const resp = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + getToken(),
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("Erro salvar usuário:", data);
      setFormMessage(data.error || "Não foi possível salvar o usuário.", true);
    } else {
      setFormMessage(id ? "Usuário atualizado!" : "Usuário criado!");
      limparFormulario();
      await carregarUsuarios();
    }
  } catch (err) {
    console.error(err);
    setFormMessage("Erro inesperado ao salvar usuário.", true);
  } finally {
    salvarBtn.disabled = false;
  }
});

// ======================= EDITAR / EXCLUIR / LOTE ===============

usersTableBody.addEventListener("click", async (e) => {
  const btn = e.target;

  // EDITAR
  if (btn.classList.contains("edit-user")) {
    const id = btn.dataset.id;
    const u = usuarios.find((x) => String(x.id) === String(id));
    if (!u) return;

    userIdInput.value = u.id;
    nomeInput.value = u.nome;
    emailInput.value = u.email;
    senhaInput.value = "";
    roleSelect.value = u.role;
    ativoCheckbox.checked = !!u.ativo;
    podeLoteCheckbox.checked = !!u.pode_lote;

    // 🔥 Esses são os que existem no banco
    permRadarCheckbox.checked = !!u.can_radar;
    permChamadosCheckbox.checked = !!u.can_chamados;
    permChatBotCheckbox.checked = !!u.can_chatbot;
    permMasterTiCheckbox.checked = !!u.can_master_ti;
    permAdminCheckbox.checked = !!u.can_admin;

    // Os outros módulos ainda não vêm do banco (sem coluna).
    permReservasCheckbox.checked = false;
    permFinanceiroCheckbox.checked = false;
    permEstoqueCheckbox.checked = false;
    permRelatoriosCheckbox.checked = false;
    permIntegracoesCheckbox.checked = false;
    permMonitoramentoCheckbox.checked = false;

    salvarBtn.textContent = "Atualizar";
    setFormMessage("Editando usuário...");

    if (selectText) {
      selectText.textContent = u.role === "admin" ? "Administrador" : "Usuário";
    }
  }

  // EXCLUIR (desativar)
  if (btn.classList.contains("delete-user")) {
    const id = btn.dataset.id;

    if (!confirm("Excluir (desativar) este usuário?")) return;

    try {
      const resp = await fetch(`${BACKEND_BASE_URL}/admin/usuarios/${id}`, {
        method: "DELETE",
        headers: { Authorization: "Bearer " + getToken() },
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error("Erro excluir:", data);
        setFormMessage(data.error || "Erro ao excluir usuário.", true);
      } else {
        setFormMessage("Usuário desativado.");
        await carregarUsuarios();
      }
    } catch (err) {
      console.error(err);
      setFormMessage("Erro ao excluir usuário.", true);
    }
  }
});

// Toggle de lote direto na tabela
usersTableBody.addEventListener("change", async (e) => {
  const input = e.target;
  if (!input.classList.contains("toggle-lote")) return;

  const id = input.dataset.id;
  const novoValor = !!input.checked;

  try {
    const resp = await fetch(`${BACKEND_BASE_URL}/admin/usuarios/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + getToken(),
      },
      body: JSON.stringify({ pode_lote: novoValor }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("Erro atualizar toggle:", data);
      setFormMessage(data.error || "Erro ao atualizar permissão.", true);
      await carregarUsuarios();
    } else {
      await carregarUsuarios();
    }
  } catch (err) {
    console.error(err);
    setFormMessage("Erro ao atualizar permissão de lote.", true);
    await carregarUsuarios();
  }
});

// ======================= SELECT PERFIL CUSTOM ==================

selectDisplay.addEventListener("click", () => {
  const visible = selectList.style.display === "block";
  selectList.style.display = visible ? "none" : "block";
});

selectList.querySelectorAll(".custom-select-item").forEach((item) => {
  item.addEventListener("click", () => {
    const val = item.dataset.value;
    realSelect.value = val;
    selectText.textContent = item.textContent;
    selectList.style.display = "none";
  });
});

document.addEventListener("click", (e) => {
  if (!selectRole.contains(e.target)) {
    selectList.style.display = "none";
  }
});

// ======================= INIT ================================

document.addEventListener("DOMContentLoaded", () => {
  carregarUsuarios();
  limparFormulario();
});
