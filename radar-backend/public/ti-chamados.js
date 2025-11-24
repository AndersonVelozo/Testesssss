// ====== CONFIG BACKEND (mesma lógica do server.js) ======
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

// Helper: chama backend autenticado
async function apiFetch(path, options = {}) {
  const token = getToken();
  if (!token) {
    window.location.href = "login.html";
    return;
  }

  const isFormData = options.isFormData === true;

  const baseHeaders = {
    Authorization: `Bearer ${token}`,
  };

  const headers = isFormData
    ? Object.assign({}, options.headers || {}, baseHeaders)
    : Object.assign({}, options.headers || {}, baseHeaders, {
        "Content-Type": "application/json",
      });

  // não mandar a flag pro fetch
  const { isFormData: _ignore, ...restOptions } = options;

  const resp = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...restOptions,
    headers,
  });

  if (!resp.ok) {
    let msg = "";

    try {
      const data = await resp.json();
      msg = data.error || data.message || "";
    } catch {
      /* ignora */
    }

    if (!msg) msg = `Erro ${resp.status} ao chamar ${path}`;
    throw new Error(msg);
  }

  if (resp.status === 204) return null;

  try {
    return await resp.json();
  } catch {
    return null;
  }
}

// ====== ELEMENTOS TI-CHAMADOS ======
const statusCards = document.querySelectorAll(".ti-status-card");
const ticketsSection = document.getElementById("tickets");
const createSection = document.getElementById("create");
const reservationsSection = document.getElementById("reservations");

// campos do formulário de ticket
const formEl = document.getElementById("ticketForm");
const typeSelect = document.getElementById("ticketType");
const categorySelect = document.getElementById("ticketCategory");
const urgencySelect = document.getElementById("ticketUrgency");
const titleInput = formEl?.querySelector("input[type='text']");
const descTextarea = formEl?.querySelector("textarea");
const ticketMsgEl = document.getElementById("ticketMsg");

// file input bonito
const fileInput = document.getElementById("ticketAttachments");
const fileNameSpan = document.getElementById("ticketFileName");

// campos do formulário de reserva
const reservationForm = document.getElementById("reservationForm");
const reservationDateInput = document.getElementById("reservationDate");
const reservationPeriodSelect = document.getElementById("reservationPeriod");
const reservationReasonTextarea = document.getElementById("reservationReason");
const reservationsListEl = document.getElementById("reservationsList");
const reservationsEmptyMsgEl = document.getElementById("reservationsEmptyMsg");

// ====== helpers visuais ======
function showInlineStatus(elementId, type, message) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.textContent = message || "";
  el.classList.remove("ti-status-ok", "ti-status-error");

  if (type === "ok") el.classList.add("ti-status-ok");
  if (type === "error") el.classList.add("ti-status-error");
}

// ====== RENDER RESUMO (cards do topo) ======
async function carregarResumo() {
  try {
    const resumo = await apiFetch("/ti/chamados/resumo");

    const mapKeys = [
      "new",
      "processing_assigned",
      "processing_planned",
      "pending",
      "solved",
      "closed",
      "deleted",
    ];

    statusCards.forEach((card, idx) => {
      const key = mapKeys[idx];
      const value = resumo[key] ?? 0;
      const strong = card.querySelector("strong");
      if (strong) strong.textContent = value;
    });
  } catch (err) {
    console.error("Erro carregarResumo:", err);
  }
}

// ====== RENDER LISTA DE CHAMADOS ======
function formatarDataHoraBR(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${ano} ${hh}:${mm}`;
}

function badgeStatus(status) {
  const s = (status || "").toLowerCase();

  if (s === "new") return '<span class="ti-badge ti-badge-new">Novo</span>';
  if (s.startsWith("processing"))
    return '<span class="ti-badge ti-badge-processing">Processando</span>';
  if (s === "pending")
    return '<span class="ti-badge ti-badge-pending">Pendente</span>';
  if (s === "solved")
    return '<span class="ti-badge ti-badge-solved">Resolvido</span>';
  if (s === "closed")
    return '<span class="ti-badge ti-badge-closed">Fechado</span>';
  if (s === "deleted")
    return '<span class="ti-badge ti-badge-deleted">Excluido</span>';

  return `<span class="ti-badge">${status || "N/A"}</span>`;
}

function renderizarTickets(lista) {
  if (!ticketsSection) return;

  if (!lista || !lista.length) {
    ticketsSection.innerHTML = `
      <h2>Tickets</h2>
      <p class="ti-empty">No item found</p>
    `;
    return;
  }

  const linhas = lista
    .map(
      (t) => `
      <tr>
        <td>${t.numero || "#" + t.id}</td>
        <td>${t.titulo}</td>
        <td>${t.categoria || "-"}</td>
        <td>${badgeStatus(t.status)}</td>
        <td>${formatarDataHoraBR(t.criado_em)}</td>
      </tr>
    `
    )
    .join("");

  ticketsSection.innerHTML = `
    <h2>Tickets</h2>
    <div class="ti-table-wrapper">
      <table class="ti-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Titulo</th>
            <th>Categoria</th>
            <th>Status</th>
            <th>Criado em </th>
          </tr>
        </thead>
        <tbody>
          ${linhas}
        </tbody>
      </table>
    </div>
  `;
}

async function carregarTickets() {
  try {
    const lista = await apiFetch("/ti/chamados");
    renderizarTickets(lista);
  } catch (err) {
    console.error("Erro carregarTickets:", err);
    if (ticketsSection) {
      ticketsSection.innerHTML = `
        <h2>Tickets</h2>
        <p class="ti-empty">Erro ao carregar seus tickets.</p>
      `;
    }
  }
}

// ====== CRIAR TICKET ======
async function handleCriarTicket(e) {
  e.preventDefault();
  if (!formEl) return;

  const titulo = titleInput?.value || "";
  const descricao = descTextarea?.value || "";
  const tipo = (typeSelect?.value || "incident").toLowerCase();
  const categoria = categorySelect?.value || "-----";
  const urgencia = (urgencySelect?.value || "medium").toLowerCase();

  if (!titulo.trim()) {
    showInlineStatus("ticketMsg", "error", "Informe um título para o chamado.");
    return;
  }

  try {
    showInlineStatus("ticketMsg", "ok", "Enviando chamado...");

    // ----- MONTA O FORM-DATA (texto + arquivos) -----
    const formData = new FormData();
    formData.append("titulo", titulo.trim());
    formData.append("descricao", descricao);
    formData.append("tipo", tipo);
    formData.append("categoria", categoria);
    formData.append("urgencia", urgencia);

    if (fileInput && fileInput.files && fileInput.files.length > 0) {
      for (let i = 0; i < fileInput.files.length; i++) {
        formData.append("anexos", fileInput.files[i]); // << nome do campo igual ao backend
      }
    }

    // usa isFormData pra NÃO forçar Content-Type JSON
    await apiFetch("/ti/chamados", {
      method: "POST",
      body: formData,
      isFormData: true,
    });

    // ----- LIMPA FORMULÁRIO -----
    if (titleInput) titleInput.value = "";
    if (descTextarea) descTextarea.value = "";
    if (categorySelect) categorySelect.value = "-----";
    if (typeSelect) typeSelect.value = "incident";
    if (urgencySelect) urgencySelect.value = "medium";

    if (fileInput) {
      fileInput.value = "";
    }
    if (fileNameSpan) {
      fileNameSpan.textContent = "Nenhum arquivo escolhido";
    }

    showInlineStatus("ticketMsg", "ok", "Chamado criado com sucesso!");

    await carregarResumo();
    await carregarTickets();
  } catch (err) {
    console.error("Erro ao criar chamado:", err);
    showInlineStatus(
      "ticketMsg",
      "error",
      err.message || "Erro ao criar chamado. Tente novamente."
    );
  }
}

// ====== RESERVAS ======
function formatarDataBR(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return isoDate;
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

function renderizarReservas(lista) {
  if (!reservationsListEl || !reservationsEmptyMsgEl) return;

  if (!lista || !lista.length) {
    reservationsListEl.innerHTML = "";
    reservationsEmptyMsgEl.style.display = "block";
    return;
  }

  reservationsEmptyMsgEl.style.display = "none";

  const cards = lista
    .map((r) => {
      const dataFmt = formatarDataBR(r.data);
      const periodo = r.periodo || "dia_todo";
      const motivo = r.motivo || "";

      let periodoLabel = "Dia todo";
      if (periodo === "manha") periodoLabel = "Manhã";
      if (periodo === "tarde") periodoLabel = "Tarde";

      return `
        <div class="ti-reservation-card">
          <div class="ti-reservation-card-header">
            <span class="ti-reservation-date">${dataFmt}</span>
            <span class="ti-reservation-period">${periodoLabel}</span>
          </div>
          ${motivo ? `<div class="ti-reservation-reason">${motivo}</div>` : ""}
        </div>
      `;
    })
    .join("");

  reservationsListEl.innerHTML = cards;
}

async function carregarReservas() {
  if (!reservationsSection) return;
  try {
    const lista = await apiFetch("/ti/reservas");
    renderizarReservas(lista);
  } catch (err) {
    console.error("Erro carregarReservas:", err);
    if (reservationsEmptyMsgEl) {
      reservationsEmptyMsgEl.textContent = "Erro ao carregar suas reservas.";
      reservationsEmptyMsgEl.style.display = "block";
    }
  }
}

async function handleCriarReserva(e) {
  e.preventDefault();
  if (!reservationForm) return;

  const data = reservationDateInput?.value || "";
  const periodo = reservationPeriodSelect?.value || "dia_todo";
  const motivo = reservationReasonTextarea?.value || "";

  if (!data) {
    showInlineStatus("reservaMsg", "error", "Escolha uma data para a reserva.");
    return;
  }

  try {
    showInlineStatus("reservaMsg", "ok", "Registrando reserva...");
    await apiFetch("/ti/reservas", {
      method: "POST",
      body: JSON.stringify({ data, periodo, motivo }),
    });

    if (reservationReasonTextarea) reservationReasonTextarea.value = "";

    showInlineStatus("reservaMsg", "ok", "Reserva registrada com sucesso!");

    await carregarReservas();
  } catch (err) {
    console.error("Erro ao registrar reserva:", err);
    showInlineStatus(
      "reservaMsg",
      "error",
      err.message || "Erro ao registrar reserva. Tente novamente."
    );
  }
}

// ====== NAV SCROLL SUAVE ======
document.querySelectorAll(".ti-nav-item[href^='#']").forEach((link) => {
  link.addEventListener("click", (e) => {
    const href = link.getAttribute("href");
    if (!href || href === "#") return;
    e.preventDefault();
    const alvo = document.querySelector(href);
    if (alvo) alvo.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

// ====== INIT ======
window.addEventListener("DOMContentLoaded", async () => {
  const token = getToken();
  if (!token) {
    alert("Sessão expirada. Faça login novamente.");
    window.location.href = "login.html";
    return;
  }

  // botão do ticket
  if (formEl) {
    const submitBtn = formEl.querySelector("#btnSubmitTicket");
    if (submitBtn) {
      submitBtn.addEventListener("click", handleCriarTicket);
    } else {
      formEl.addEventListener("submit", handleCriarTicket);
    }
  }

  // file input
  if (fileInput && fileNameSpan) {
    fileInput.addEventListener("change", () => {
      if (!fileInput.files || fileInput.files.length === 0) {
        fileNameSpan.textContent = "Nenhum arquivo escolhido";
        return;
      }
      if (fileInput.files.length === 1) {
        fileNameSpan.textContent = fileInput.files[0].name;
      } else {
        fileNameSpan.textContent = `${fileInput.files.length} arquivos selecionados`;
      }
    });
  }

  // form de reservas
  if (reservationForm) {
    const btnReservation = document.getElementById("btnRegistrarReserva");
    if (btnReservation) {
      btnReservation.addEventListener("click", handleCriarReserva);
    } else {
      reservationForm.addEventListener("submit", handleCriarReserva);
    }
  }

  await carregarResumo();
  await carregarTickets();
  await carregarReservas();
});
