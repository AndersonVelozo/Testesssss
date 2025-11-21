// ====== CONFIG BACKEND ======
const isLocalHostMaster =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const BACKEND_BASE_URL_MASTER = isLocalHostMaster
  ? "http://localhost:3000"
  : "https://testesssss-production.up.railway.app";

function getTokenMaster() {
  return (
    localStorage.getItem("radar_token") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}

async function apiFetchMaster(path, options = {}) {
  const token = getTokenMaster();
  if (!token) {
    alert("Sessão expirada. Faça login novamente.");
    window.location.href = "login.html";
    throw new Error("Sem token");
  }

  const headers = Object.assign({}, options.headers || {}, {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  });

  const resp = await fetch(`${BACKEND_BASE_URL_MASTER}${path}`, {
    ...options,
    headers,
  });

  if (!resp.ok) {
    if (resp.status === 401) {
      alert("Sessão expirada. Faça login novamente.");
      window.location.href = "login.html";
    }
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  return resp.json();
}

// ====== ELEMENTOS MASTER ======
const metricCards = document.querySelectorAll(".master-metric-card");
const tableBodyMaster = document.querySelector(".master-table tbody");
const timelineEl = document.querySelector(".master-timeline");

// ====== FORMATADORES ======
function formatarDataHoraBRMaster(iso) {
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

function badgeMaster(status) {
  const s = (status || "").toLowerCase();
  if (s === "new")
    return '<span class="master-badge master-badge-open">Aberto</span>';
  if (s.startsWith("processing"))
    return '<span class="master-badge master-badge-progress">Em andamento</span>';
  if (s === "pending")
    return '<span class="master-badge master-badge-wait">Pendente aprovação</span>';
  if (s === "solved" || s === "closed")
    return '<span class="master-badge master-badge-done">Concluído</span>';
  if (s === "deleted")
    return '<span class="master-badge master-badge-deleted">Deleted</span>';
  return `<span class="master-badge">${status || "-"}</span>`;
}

// ====== MÉTRICAS (cards) ======
async function carregarMetricas() {
  try {
    const m = await apiFetchMaster("/ti/master/resumo");

    const valores = [
      m.abertos ?? 0,
      m.emAndamento ?? 0,
      m.pendentesAprovacao ?? 0,
      m.concluidosHoje ?? 0,
    ];

    metricCards.forEach((card, idx) => {
      const span = card.querySelector(".master-metric-value");
      if (span) span.textContent = valores[idx];
    });
  } catch (err) {
    console.error("Erro carregarMetricas:", err);
  }
}

// ====== TABELA CHAMADOS RECENTES ======
async function carregarChamadosRecentes() {
  if (!tableBodyMaster) return;

  try {
    const lista = await apiFetchMaster("/ti/master/chamados?limit=20");

    if (!lista.length) {
      tableBodyMaster.innerHTML = `
        <tr>
          <td colspan="6">Nenhum chamado encontrado.</td>
        </tr>
      `;
      return;
    }

    tableBodyMaster.innerHTML = lista
      .map(
        (t) => `
        <tr data-id="${t.id}">
          <td>${t.numero || "#" + t.id}</td>
          <td>${t.titulo}</td>
          <td>${t.solicitante_nome || "-"}</td>
          <td>${t.categoria || "-"}</td>
          <td>${badgeMaster(t.status)}</td>
          <td>${formatarDataHoraBRMaster(t.criado_em)}</td>
        </tr>
      `
      )
      .join("");
  } catch (err) {
    console.error("Erro carregarChamadosRecentes:", err);
    tableBodyMaster.innerHTML = `
      <tr>
        <td colspan="6">Erro ao carregar chamados.</td>
      </tr>
    `;
  }
}

// ====== ATIVIDADE RECENTE (timeline) ======
async function carregarAtividade() {
  if (!timelineEl) return;

  try {
    const lista = await apiFetchMaster("/ti/master/atividade");

    if (!lista.length) {
      timelineEl.innerHTML = `
        <li>
          <span class="master-timeline-dot"></span>
          <div class="master-timeline-content">
            <p class="master-timeline-meta">Nenhuma atividade recente.</p>
          </div>
        </li>
      `;
      return;
    }

    timelineEl.innerHTML = lista
      .map(
        (item) => `
        <li>
          <span class="master-timeline-dot"></span>
          <div class="master-timeline-content">
            <strong>${item.numero || ""}</strong>
            ${item.descricao}
            <p class="master-timeline-meta">
              ${formatarDataHoraBRMaster(item.criadoEm)} • ${
          item.criadoPorNome || ""
        }
            </p>
          </div>
        </li>
      `
      )
      .join("");
  } catch (err) {
    console.error("Erro carregarAtividade:", err);
  }
}

// (Opcional) alterar status ao clicar em uma linha
async function alterarStatusChamado(id, novoStatus) {
  try {
    await apiFetchMaster(`/ti/master/chamados/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status: novoStatus }),
    });
    await carregarMetricas();
    await carregarChamadosRecentes();
    await carregarAtividade();
  } catch (err) {
    console.error("Erro alterarStatusChamado:", err);
    alert("Erro ao alterar status do chamado.");
  }
}

// Exemplo: duplo clique numa linha pergunta novo status
if (tableBodyMaster) {
  tableBodyMaster.addEventListener("dblclick", async (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const id = tr.getAttribute("data-id");
    if (!id) return;

    const novoStatus = prompt(
      "Novo status (new, processing_assigned, processing_planned, pending, solved, closed, deleted):",
      "processing_assigned"
    );
    if (!novoStatus) return;

    await alterarStatusChamado(id, novoStatus);
  });
}

// ====== INIT ======
window.addEventListener("DOMContentLoaded", async () => {
  const token = getTokenMaster();
  if (!token) {
    alert("Sessão expirada. Faça login novamente.");
    window.location.href = "login.html";
    return;
  }

  await carregarMetricas();
  await carregarChamadosRecentes();
  await carregarAtividade();
});
