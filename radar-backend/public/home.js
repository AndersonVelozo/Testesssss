// ====== MESMA LÓGICA DE TOKEN QUE VOCÊ USA NO server.js ======
function getToken() {
  return (
    localStorage.getItem("radar_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}

// Decodifica o nome do usuário do JWT
function getCurrentUserNameFromToken() {
  const token = getToken();
  if (!token) return "";

  try {
    const [, payloadBase64] = token.split(".");
    const normalized = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    const payload = JSON.parse(json);
    return payload.nome || payload.name || "";
  } catch (err) {
    console.error("Erro ao ler nome do token:", err);
    return "";
  }
}

// Redireciona para login se não estiver logado
function ensureAuthenticated() {
  const token = getToken();
  if (!token) {
    window.location.href = "login.html";
  }
}

// ====== HANDLERS ======
window.addEventListener("DOMContentLoaded", () => {
  ensureAuthenticated();

  const nome = getCurrentUserNameFromToken();
  const nomeSpan = document.getElementById("homeUserName");
  if (nomeSpan && nome) {
    nomeSpan.textContent = nome;
  }

  const logoutBtn = document.getElementById("homeLogoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("radar_token");
      localStorage.removeItem("token");
      localStorage.removeItem("authToken");
      window.location.href = "login.html";
    });
  }

  // CARD 1 – RADAR
  const cardRadar = document.getElementById("cardRadar");
  if (cardRadar) {
    cardRadar.addEventListener("click", () => {
      window.location.href = "index.html"; // sua página do coletor
    });
  }

  // CARD 2 – CHAMADOS TI
  const cardChamadosTi = document.getElementById("cardChamadosTi");
  if (cardChamadosTi) {
    cardChamadosTi.addEventListener("click", () => {
      // abre página interna de chamados
      window.location.href = "ti-chamados.html";
      // se preferir abrir sistema externo, troque por:
      // window.open("https://SEU-SISTEMA-DE-CHAMADOS.com", "_blank");
    });
  }

  // Cards 3 e 4 por enquanto só mostram alerta se não estiverem habilitados
  const cardReservas = document.getElementById("cardReservas");
  const cardAdmin = document.getElementById("cardAdmin");

  function warnDev() {
    alert("Este módulo ainda está em desenvolvimento 🙂");
  }

  if (cardReservas) cardReservas.addEventListener("click", warnDev);
  if (cardAdmin) cardAdmin.addEventListener("click", warnDev);
});
