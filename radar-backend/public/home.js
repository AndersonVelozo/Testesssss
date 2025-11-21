// ====== TOKEN / AUTH COM MESMOS PADRÕES DO PROJETO ======
function getToken() {
  return (
    localStorage.getItem("radar_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}

// Decodifica o payload do JWT (quando possível)
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

// Nome + role: prioriza o que veio do backend e foi salvo no localStorage
function getCurrentUserInfo() {
  const token = getToken();
  const payload = token ? decodeJwtPayload(token) : {};

  const nomeLS = localStorage.getItem("usuarioNome") || "";
  const roleLS = localStorage.getItem("usuarioRole") || "";

  const nome = nomeLS || payload.nome || payload.name || "";
  const role = roleLS || payload.role || "user";
  const permissions = payload.permissions || {};

  return { nome, role, permissions };
}

// Garante que só entra aqui logado
function ensureAuthenticated() {
  const token = getToken();
  if (!token) {
    window.location.href = "login.html";
  }
}

// ====== HELPERS ======
function getInitialsFromName(nome) {
  if (!nome) return "U";
  const parts = nome.trim().split(" ");
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ====== COMPORTAMENTO DA PÁGINA ======
window.addEventListener("DOMContentLoaded", () => {
  ensureAuthenticated();

  const { nome, role, permissions } = getCurrentUserInfo();
  const isAdmin = role === "admin" || !!permissions.admin;
  const canMasterTi = !!permissions.masterTi || isAdmin;

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
    const goRadar = () => (window.location.href = "index.html");
    cardRadar.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "button") return;
      goRadar();
    });
    btnRadar.addEventListener("click", goRadar);
  }

  // ====== CARD CHAMADOS TI (self-service) ======
  const cardChamados = document.getElementById("cardChamadosTi");
  const btnChamados = document.getElementById("btnChamados");

  if (cardChamados && btnChamados) {
    const goChamados = () => (window.location.href = "ti-chamados.html");

    cardChamados.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "button") return;
      goChamados();
    });

    btnChamados.addEventListener("click", goChamados);
  }

  // ====== CARD RESERVAS (placeholder) ======
  const cardReservas = document.getElementById("cardReservas");
  const btnReservas = document.getElementById("btnReservas");

  function warnDev() {
    alert("Este módulo ainda está em desenvolvimento 🙂");
  }

  if (cardReservas) {
    cardReservas.addEventListener("click", (e) => {
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

  if (cardMasterTi && btnMasterTi) {
    if (canMasterTi) {
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
        goMaster();
      });

      btnMasterTi.addEventListener("click", (e) => {
        e.preventDefault();
        goMaster();
      });
    } else {
      btnMasterTi.disabled = true;
      btnMasterTi.textContent = "Apenas para equipe de TI";

      if (cardMasterTiText) {
        cardMasterTiText.textContent =
          "Somente a equipe de TI autorizada tem acesso a este painel.";
      }

      cardMasterTi.addEventListener("click", () => {
        alert("Acesso restrito ao time de TI.");
      });
    }
  }

  // ====== CARD ADMINISTRAÇÃO DE USUÁRIOS ======
  const cardAdmin = document.getElementById("cardAdmin");
  const btnAdmin = document.getElementById("btnAdmin");
  const cardAdminText = document.getElementById("cardAdminText");

  if (cardAdmin && btnAdmin) {
    if (isAdmin) {
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
        goAdmin();
      });

      btnAdmin.addEventListener("click", (e) => {
        e.preventDefault();
        goAdmin();
      });
    } else {
      btnAdmin.disabled = true;
      btnAdmin.textContent = "Apenas para administradores";

      if (cardAdminText) {
        cardAdminText.textContent =
          "Somente administradores do sistema têm acesso à gestão de usuários.";
      }

      cardAdmin.addEventListener("click", () => {
        alert("Acesso restrito ao administrador do sistema.");
      });
    }
  }
});
