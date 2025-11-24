// ================== TOKEN / AUTH ==================

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
    console.warn("Não foi possível decodificar o token:", err);
    return {};
  }
}

function getCurrentUserInfo() {
  const token = getToken();
  if (!token) return { nome: "", role: "user", permissions: {} };

  const payload = decodeJwtPayload(token);

  const nomeLS = localStorage.getItem("usuarioNome") || "";
  const roleLS = localStorage.getItem("usuarioRole") || "";

  const nome = nomeLS || payload.nome || payload.name || "";
  const role = roleLS || payload.role || "user";
  const permissions = payload.permissions || {};

  return { nome, role, permissions };
}

function ensureAuthenticated() {
  const token = getToken();
  if (!token) {
    window.location.href = "login.html";
  }
}

// ================== PERMISSÕES DO PORTAL ==================

function aplicarPermissoesPortal() {
  const { role, permissions } = getCurrentUserInfo();
  const perms = permissions || {};
  const isAdmin = role === "admin" || !!perms.admin;

  // ===== OBTER TODOS OS CARDS =====
  const cardRadar = document.getElementById("cardRadar");
  const cardChamados = document.getElementById("cardChamadosTi");
  const cardChatBot = document.getElementById("cardChatBot");
  const cardMasterTi = document.getElementById("cardMasterTi");
  const cardAdmin = document.getElementById("cardAdmin");

  const cardReservas = document.getElementById("cardReservas");
  const cardFinanceiro = document.getElementById("cardFinanceiro");
  const cardEstoque = document.getElementById("cardEstoque");
  const cardIntegracoes = document.getElementById("cardIntegracoes");
  const cardMonitoramento = document.getElementById("cardMonitoramento");

  const btnRadar = document.getElementById("btnRadar");
  const btnChamados = document.getElementById("btnChamados");
  const btnMasterTi = document.getElementById("btnMasterTi");
  const btnAdmin = document.getElementById("btnAdmin");

  function esconder(card) {
    if (card) card.style.display = "none";
  }

  // ================== REGRAS DE EXIBIÇÃO ==================

  // --- CHAMADOS (aparece se tiver)
  if (perms.chamados || isAdmin) {
    if (btnChamados) {
      btnChamados.disabled = false;
      btnChamados.textContent = "Acessar Central de Chamados";
    }
  } else {
    esconder(cardChamados);
  }

  // --- RADAR
  if (perms.radar || isAdmin) {
    if (btnRadar) {
      btnRadar.disabled = false;
      btnRadar.textContent = "Acessar Coletor RADAR";
    }
  } else {
    esconder(cardRadar);
  }

  // --- CHAT BOT (por enquanto, só admins enxergam)
  if (!isAdmin && !perms.chatbot) {
    esconder(cardChatBot);
  }

  // --- MASTER TI
  if (perms.masterTi || isAdmin) {
    if (btnMasterTi) {
      btnMasterTi.disabled = false;
      btnMasterTi.classList.remove("btn-secondary");
      btnMasterTi.classList.add("btn-primary");
      btnMasterTi.textContent = "Acessar Painel Master TI";
    }
  } else {
    esconder(cardMasterTi);
  }

  // --- ADMIN
  if (isAdmin) {
    if (btnAdmin) {
      btnAdmin.disabled = false;
      btnAdmin.classList.remove("btn-secondary");
      btnAdmin.classList.add("btn-primary");
      btnAdmin.textContent = "Gerenciar Usuários";
    }
  } else {
    esconder(cardAdmin);
  }

  // ====== TODOS OS CARDS EM DESENVOLVIMENTO ======
  // Somente admin (ou quem tiver permissão específica no futuro) vê

  if (!isAdmin && !perms.reservas) esconder(cardReservas);
  if (!isAdmin && !perms.financeiro) esconder(cardFinanceiro);
  if (!isAdmin && !perms.estoque) esconder(cardEstoque);
  if (!isAdmin && !perms.integracoes) esconder(cardIntegracoes);
  if (!isAdmin && !perms.monitoramento) esconder(cardMonitoramento);
}

// ================== HELPERS ==================

function getInitialsFromName(nome) {
  if (!nome) return "U";
  const parts = nome.trim().split(" ");
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ================== COMPORTAMENTO DA PÁGINA ==================

window.addEventListener("DOMContentLoaded", () => {
  ensureAuthenticated();

  const { nome, role, permissions } = getCurrentUserInfo();
  const isAdmin = role === "admin" || !!permissions.admin;
  const canMasterTi = !!permissions.masterTi || isAdmin;

  aplicarPermissoesPortal();

  // Header com nome do usuário
  const nomeSpan = document.getElementById("homeUserName");
  if (nomeSpan && nome) nomeSpan.textContent = nome;

  // Botão sair
  const logoutBtn = document.getElementById("homeLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("radar_token");
      localStorage.removeItem("token");
      localStorage.removeItem("authToken");
      localStorage.removeItem("usuarioNome");
      localStorage.removeItem("usuarioRole");
      window.location.href = "login.html";
    });
  }

  // ====== CARD RADAR ======
  const cardRadar = document.getElementById("cardRadar");
  const btnRadar = document.getElementById("btnRadar");

  if (cardRadar && btnRadar) {
    const goRadar = () => {
      window.location.href = "index.html";
    };

    cardRadar.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "button") return;
      if (cardRadar.style.display === "none") return;
      goRadar();
    });
    btnRadar.addEventListener("click", (e) => {
      e.preventDefault();
      goRadar();
    });
  }

  // ====== CARD CHAMADOS TI ======
  const cardChamados = document.getElementById("cardChamadosTi");
  const btnChamados = document.getElementById("btnChamados");

  if (cardChamados && btnChamados) {
    const goChamados = () => {
      window.location.href = "ti-chamados.html";
    };

    cardChamados.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "button") return;
      if (cardChamados.style.display === "none") return;
      goChamados();
    });

    btnChamados.addEventListener("click", (e) => {
      e.preventDefault();
      goChamados();
    });
  }

  // ====== CARD RESERVAS (placeholder) ======
  const cardReservas = document.getElementById("cardReservas");
  const btnReservas = document.getElementById("btnReservas");

  function warnDev() {
    alert("Este módulo ainda está em desenvolvimento 🙂");
  }

  if (cardReservas) {
    cardReservas.addEventListener("click", (e) => {
      if (cardReservas.style.display === "none") return;
      if (btnReservas && btnReservas.disabled) warnDev();
    });
  }
  if (btnReservas) {
    btnReservas.addEventListener("click", (e) => {
      e.preventDefault();
      warnDev();
    });
  }

  // ====== CARD PAINEL MASTER TI ======
  const cardMasterTi = document.getElementById("cardMasterTi");
  const btnMasterTi = document.getElementById("btnMasterTi");
  const cardMasterTiText = document.getElementById("cardMasterTiText");

  if (cardMasterTi && btnMasterTi && canMasterTi) {
    btnMasterTi.disabled = false;
    btnMasterTi.textContent = "Acessar Painel Master TI";
    btnMasterTi.classList.remove("btn-secondary");
    btnMasterTi.classList.add("btn-primary");

    if (cardMasterTiText) {
      cardMasterTiText.textContent =
        "Acesse o painel master para gerenciar chamados, fila de TI e relatórios.";
    }

    const goMaster = () => (window.location.href = "ti-master.html");

    cardMasterTi.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "button") return;
      if (cardMasterTi.style.display === "none") return;
      goMaster();
    });

    btnMasterTi.addEventListener("click", (e) => {
      e.preventDefault();
      goMaster();
    });
  }

  // ====== CARD ADMIN USUÁRIOS ======
  const cardAdmin = document.getElementById("cardAdmin");
  const btnAdmin = document.getElementById("btnAdmin");
  const cardAdminText = document.getElementById("cardAdminText");

  if (cardAdmin && btnAdmin && isAdmin) {
    btnAdmin.disabled = false;
    btnAdmin.textContent = "Gerenciar Usuários";
    btnAdmin.classList.remove("btn-secondary");
    btnAdmin.classList.add("btn-primary");

    if (cardAdminText) {
      cardAdminText.textContent =
        "Gerencie contas, permissões de acesso, perfis e status dos usuários do portal.";
    }

    const goAdmin = () => (window.location.href = "admin.html");

    cardAdmin.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "button") return;
      if (cardAdmin.style.display === "none") return;
      goAdmin();
    });

    btnAdmin.addEventListener("click", (e) => {
      e.preventDefault();
      goAdmin();
    });
  }
});
