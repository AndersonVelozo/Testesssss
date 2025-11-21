// ====== CONFIG BACKEND ======
const isLocalHostMaster =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const BACKEND_BASE_URL_MASTER = isLocalHostMaster
  ? "http://localhost:3000"
  : "https://radar-backend-omjv.onrender.com"; // URL do backend no Render

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
      return;
    }
    if (resp.status === 403) {
      alert("Você não tem permissão para acessar o Painel Master TI.");
      window.location.href = "home.html";
      return;
    }
    const text = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  return resp.json();
}

// ====== ELEMENTOS MASTER ======
const metricCards = document.querySelectorAll(".master-metric-card");
const tableBodyMaster = document.querySelector(".master-table tbody");
const timelineEl = document.getElementById("masterTimeline");
const searchInput = document.getElementById("searchTickets");
const btnNovoChamado = document.getElementById("btnNovoChamado");
const btnGoAdminUsers = document.getElementById("btnGoAdminUsers");
const masterUserNameEl = document.getElementById("masterUserName");
const masterUserRoleEl = document.getElementById("masterUserRole");

// Detalhe / modal
const detailOverlay = document.getElementById("ticketDetailOverlay");
const detailCloseBtn = document.getElementById("detailCloseBtn");
const detailTitleEl = document.getElementById("detailTitle");
const detailStatusBadgeEl = document.getElementById("detailStatusBadge");
const detailSolicitanteEl = document.getElementById("detailSolicitante");
const detailCategoriaEl = document.getElementById("detailCategoria");
const detailUrgenciaEl = document.getElementById("detailUrgencia");
const detailCriadoEmEl = document.getElementById("detailCriadoEm");
const detailResponsavelEl = document.getElementById("detailResponsavel");
const detailDescricaoEl = document.getElementById("detailDescricao");
const detailTimelineEl = document.getElementById("detailTimeline");
const detailComentarioEl = document.getElementById("detailComentario");
const detailSendCommentBtn = document.getElementById("detailSendComment");

// NOVOS elementos para mudar status dentro do modal
const detailStatusSelect = document.getElementById("detailStatusSelect");
const detailUpdateStatusBtn = document.getElementById("detailUpdateStatusBtn");

// cache de chamados para filtro
let chamadosCacheMaster = [];
let detalheChamadoAtualId = null;

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
    return '<span class="master-badge master-badge-deleted">Deletado</span>';
  return `<span class="master-badge">${status || "-"}</span>`;
}

function urgenciaLabel(u) {
  const s = (u || "").toLowerCase();
  if (s === "low") return "Baixa";
  if (s === "medium") return "Média";
  if (s === "high") return "Alta";
  if (s === "critical") return "Crítica";
  return u || "-";
}

// ====== CARREGAR DADOS DO USUÁRIO (auth/me) ======
async function carregarUsuarioMaster() {
  try {
    const resp = await apiFetchMaster("/auth/me");
    const usuario = resp.usuario;

    if (!usuario) return;

    if (masterUserNameEl)
      masterUserNameEl.textContent = usuario.nome || "Master TI";

    if (masterUserRoleEl) {
      if (usuario.permissions?.masterTi) {
        masterUserRoleEl.textContent = "Master TI";
      } else if (usuario.permissions?.admin || usuario.role === "admin") {
        masterUserRoleEl.textContent = "Administrador global";
      } else {
        masterUserRoleEl.textContent = "Usuário";
      }
    }

    const perms = usuario.permissions || {};
    const temPermissao =
      perms.masterTi || perms.admin || usuario.role === "admin";

    if (!temPermissao) {
      alert("Você não tem permissão para acessar o Painel Master TI.");
      window.location.href = "home.html";
    }
  } catch (err) {
    console.error("Erro carregarUsuarioMaster:", err);
  }
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

// ====== RENDERIZAÇÃO DA TABELA ======
function renderizarTabelaChamados(lista) {
  if (!tableBodyMaster) return;

  if (!lista || !lista.length) {
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
}

// ====== TABELA CHAMADOS RECENTES ======
async function carregarChamadosRecentes() {
  if (!tableBodyMaster) return;

  try {
    const lista = await apiFetchMaster("/ti/master/chamados?limit=20");
    chamadosCacheMaster = lista || [];
    renderizarTabelaChamados(chamadosCacheMaster);
  } catch (err) {
    console.error("Erro carregarChamadosRecentes:", err);
    tableBodyMaster.innerHTML = `
      <tr>
        <td colspan="6">Erro ao carregar chamados.</td>
      </tr>
    `;
  }
}

// ====== FILTRO LOCAL (número / título) ======
function aplicarFiltroChamados() {
  const termo = (searchInput?.value || "").toLowerCase().trim();
  if (!termo) {
    renderizarTabelaChamados(chamadosCacheMaster);
    return;
  }

  const filtrados = chamadosCacheMaster.filter((c) => {
    const numero = (c.numero || "#" + c.id).toLowerCase();
    const titulo = (c.titulo || "").toLowerCase();
    return numero.includes(termo) || titulo.includes(termo);
  });

  renderizarTabelaChamados(filtrados);
}

// ====== ATIVIDADE RECENTE (timeline geral) ======
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

// ====== ALTERAR STATUS ======
async function alterarStatusChamado(id, novoStatus) {
  try {
    await apiFetchMaster(`/ti/master/chamados/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status: novoStatus }),
    });

    // atualiza cards / tabela / timeline
    await carregarMetricas();
    await carregarChamadosRecentes();
    await carregarAtividade();

    // se o detalhe desse chamado estiver aberto, recarrega
    if (detalheChamadoAtualId && Number(detalheChamadoAtualId) === Number(id)) {
      await abrirDetalheChamado(id);
    }

    alert("Status atualizado com sucesso.");
  } catch (err) {
    console.error("Erro alterarStatusChamado:", err);
    alert("Erro ao alterar status do chamado.");
  }
}

// ====== DETALHES DO CHAMADO (modal) ======
function abrirOverlay() {
  if (!detailOverlay) return;
  detailOverlay.classList.remove("hidden");
}

function fecharOverlay() {
  if (!detailOverlay) return;
  detailOverlay.classList.add("hidden");
  detalheChamadoAtualId = null;
  if (detailComentarioEl) detailComentarioEl.value = "";
}

async function abrirDetalheChamado(id) {
  try {
    const resp = await apiFetchMaster(`/ti/master/chamados/${id}`);
    const { chamado, atividades = [] } = resp;

    detalheChamadoAtualId = chamado.id;

    if (detailTitleEl)
      detailTitleEl.textContent = `${chamado.numero} - ${chamado.titulo}`;
    if (detailStatusBadgeEl)
      detailStatusBadgeEl.innerHTML = badgeMaster(chamado.status);

    if (detailSolicitanteEl)
      detailSolicitanteEl.textContent = chamado.solicitante_nome || "-";
    if (detailCategoriaEl)
      detailCategoriaEl.textContent = chamado.categoria || "-";
    if (detailUrgenciaEl)
      detailUrgenciaEl.textContent = urgenciaLabel(chamado.urgencia);
    if (detailCriadoEmEl)
      detailCriadoEmEl.textContent = formatarDataHoraBRMaster(
        chamado.criado_em
      );
    if (detailResponsavelEl)
      detailResponsavelEl.textContent =
        chamado.responsavel_nome || "Não atribuído";
    if (detailDescricaoEl)
      detailDescricaoEl.textContent = chamado.descricao || "-";

    // seta o select de status com o valor atual
    if (detailStatusSelect) {
      detailStatusSelect.value = chamado.status || "new";
    }

    if (detailTimelineEl) {
      if (!atividades.length) {
        detailTimelineEl.innerHTML = `
          <li>
            <span class="master-timeline-dot"></span>
            <div class="master-timeline-content">
              <p class="master-timeline-meta">Nenhum histórico registrado.</p>
            </div>
          </li>
        `;
      } else {
        detailTimelineEl.innerHTML = atividades
          .map(
            (a) => `
            <li>
              <span class="master-timeline-dot"></span>
              <div class="master-timeline-content">
                <strong>${a.tipo}</strong> - ${a.descricao}
                <p class="master-timeline-meta">
                  ${formatarDataHoraBRMaster(a.criadoEm)} • ${
              a.criadoPorNome || ""
            }
                </p>
              </div>
            </li>
          `
          )
          .join("");
      }
    }

    abrirOverlay();
  } catch (err) {
    console.error("Erro abrirDetalheChamado:", err);
    alert("Erro ao carregar detalhes do chamado.");
  }
}

// Enviar comentário
async function enviarComentarioDetalhe() {
  if (!detalheChamadoAtualId) return;
  const texto = (detailComentarioEl?.value || "").trim();
  if (!texto) {
    alert("Digite um comentário.");
    return;
  }

  try {
    await apiFetchMaster(
      `/ti/master/chamados/${detalheChamadoAtualId}/comentario`,
      {
        method: "POST",
        body: JSON.stringify({ texto }),
      }
    );

    detailComentarioEl.value = "";
    await abrirDetalheChamado(detalheChamadoAtualId);
  } catch (err) {
    console.error("Erro enviarComentarioDetalhe:", err);
    alert("Erro ao enviar comentário.");
  }
}

// ====== EVENTOS NA TABELA ======
if (tableBodyMaster) {
  // clique simples → abre detalhes
  tableBodyMaster.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const id = tr.getAttribute("data-id");
    if (!id) return;
    await abrirDetalheChamado(id);
  });

  // ❌ tiramos o duplo clique porque o modal bloqueia o segundo clique
}

// ====== EVENTOS DE INTERFACE ======
if (searchInput) {
  searchInput.addEventListener("input", () => {
    aplicarFiltroChamados();
  });
}

if (btnNovoChamado) {
  btnNovoChamado.addEventListener("click", () => {
    // abre tela de abertura de chamado (self-service)
    window.location.href = "ti-chamados.html";
  });
}

if (btnGoAdminUsers) {
  btnGoAdminUsers.addEventListener("click", () => {
    window.location.href = "admin.html";
  });
}

if (detailCloseBtn) {
  detailCloseBtn.addEventListener("click", fecharOverlay);
}
if (detailOverlay) {
  detailOverlay.addEventListener("click", (e) => {
    if (e.target === detailOverlay) fecharOverlay();
  });
}
if (detailSendCommentBtn) {
  detailSendCommentBtn.addEventListener("click", enviarComentarioDetalhe);
}

// evento novo: mudar status pelo select + botão
if (detailUpdateStatusBtn && detailStatusSelect) {
  detailUpdateStatusBtn.addEventListener("click", async () => {
    if (!detalheChamadoAtualId) {
      alert("Nenhum chamado selecionado.");
      return;
    }
    const novoStatus = detailStatusSelect.value;
    if (!novoStatus) return;

    await alterarStatusChamado(detalheChamadoAtualId, novoStatus);
  });
}

/* ====== CONTROLE DAS VIEWS (SIDEBAR) ====== */
const navItems = document.querySelectorAll(".master-nav-item");
const viewDashboard = document.getElementById("viewDashboard");
const viewChamados = document.getElementById("viewChamados");
const viewRelatorios = document.getElementById("viewRelatorios");
const viewConfig = document.getElementById("viewConfig");
const mainTitleEl = document.getElementById("masterMainTitle");
const mainSubtitleEl = document.getElementById("masterMainSubtitle");

function setActiveView(view) {
  // limpa active do menu
  navItems.forEach((item) => {
    if (item.dataset.view === view) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // esconde todas as views
  [viewDashboard, viewChamados, viewRelatorios, viewConfig].forEach((sec) => {
    if (!sec) return;
    sec.classList.add("hidden");
  });

  // mostra a view selecionada + ajusta títulos
  if (view === "dashboard") {
    viewDashboard?.classList.remove("hidden");
    if (mainTitleEl) mainTitleEl.textContent = "Painel Master TI";
    if (mainSubtitleEl)
      mainSubtitleEl.textContent =
        "Visão geral dos chamados internos de TI e atividades recentes.";
  } else if (view === "chamados") {
    viewChamados?.classList.remove("hidden");
    if (mainTitleEl) mainTitleEl.textContent = "Chamados de TI";
    if (mainSubtitleEl)
      mainSubtitleEl.textContent =
        "Área dedicada à gestão da fila de chamados (visão em construção).";
  } else if (view === "relatorios") {
    viewRelatorios?.classList.remove("hidden");
    if (mainTitleEl) mainTitleEl.textContent = "Relatórios de TI";
    if (mainSubtitleEl)
      mainSubtitleEl.textContent =
        "Indicadores, métricas e análises de desempenho (em breve).";
  } else if (view === "config") {
    viewConfig?.classList.remove("hidden");
    if (mainTitleEl) mainTitleEl.textContent = "Configurações do Painel";
    if (mainSubtitleEl)
      mainSubtitleEl.textContent =
        "Ajuste preferências e regras do painel Master TI.";
  }
}

// listeners dos itens do menu
navItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const view = item.dataset.view || "dashboard";
    setActiveView(view);
  });
});

// ====== INIT ======
window.addEventListener("DOMContentLoaded", async () => {
  const token = getTokenMaster();
  if (!token) {
    alert("Sessão expirada. Faça login novamente.");
    window.location.href = "login.html";
    return;
  }

  await carregarUsuarioMaster();
  await carregarMetricas();
  await carregarChamadosRecentes();
  await carregarAtividade();

  // deixa a view padrão como dashboard
  setActiveView("dashboard");

  // "tempo real" simples
  setInterval(async () => {
    await carregarMetricas();
    await carregarChamadosRecentes();
    await carregarAtividade();

    if (detalheChamadoAtualId) {
      await abrirDetalheChamado(detalheChamadoAtualId);
    }
  }, 30000);
});
