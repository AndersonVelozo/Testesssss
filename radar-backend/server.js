// ---------- ELEMENTOS BÁSICOS ----------
const cnpjInput = document.getElementById("cnpj");
const rawText = document.getElementById("rawText");
const tableBody = document.querySelector("#resultTable tbody");

const openReceitaBtn = document.getElementById("openReceita");
const importExcelBtn = document.getElementById("importExcelBtn");
const fileInput = document.getElementById("fileInput");

const extractAddBtn = document.getElementById("extractAdd");
const clearTableBtn = document.getElementById("clearTable");
const exportExcelBtn = document.getElementById("exportExcel");
const retryErrorsBtn = document.getElementById("retryErrors");

const loteStatusEl = document.getElementById("loteStatus");
const loteProgressBar = document.getElementById("loteProgressBar");

// ---------- LOCALSTORAGE ----------
const STORAGE_KEY = "radar_registros_habilitacao";

let registros = []; // array de objetos {cnpj, contribuinte, situacao, dataSituacao, submodalidade}

function salvarNoLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registros));
  } catch (e) {
    console.error("Erro ao salvar no localStorage:", e);
  }
}

function carregarDoLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error("Erro ao carregar do localStorage:", e);
    return [];
  }
}

function normalizarCNPJ(v) {
  return v.replace(/\D/g, "");
}

function removerLinhaVazia() {
  const noDataRow = tableBody.querySelector(".no-data-row");
  if (noDataRow) tableBody.removeChild(noDataRow);
}

// ---------- RENDERIZAÇÃO DA TABELA ----------
function criarLinhaDOM(registro) {
  const tr = document.createElement("tr");
  const sitUpper = (registro.situacao || "").toUpperCase();

  tr.innerHTML = `
    <td>${registro.cnpj || ""}</td>
    <td>${registro.contribuinte || ""}</td>
    <td>
      <span class="tag ${
        /INDEFERIDA|CANCELADA|SUSPENSA|ERRO/.test(sitUpper) ? "negado" : ""
      }">
        ${registro.situacao || ""}
      </span>
    </td>
    <td>${registro.dataSituacao || ""}</td>
    <td>${registro.submodalidade || ""}</td>
  `;

  tableBody.appendChild(tr);
}

function adicionarLinhaTabela(
  cnpj,
  contribuinte,
  situacao,
  dataSituacao,
  submodalidade
) {
  removerLinhaVazia();

  const registro = {
    cnpj: cnpj || "",
    contribuinte: contribuinte || "",
    situacao: situacao || "",
    dataSituacao: dataSituacao || "",
    submodalidade: submodalidade || "",
  };

  registros.push(registro);
  criarLinhaDOM(registro);
  salvarNoLocalStorage();
}

function renderizarTodos() {
  tableBody.innerHTML = `
    <tr class="no-data-row">
      <td colspan="5" class="no-data">Nenhum registro adicionado ainda</td>
    </tr>
  `;

  if (!registros.length) return;

  removerLinhaVazia();
  registros.forEach((r) => criarLinhaDOM(r));
}

// ---------- PROGRESSO DO LOTE ----------
function atualizarProgressoLote(processados, total) {
  if (!total || total <= 0) {
    loteStatusEl.textContent = "Nenhuma consulta em lote em andamento.";
    loteProgressBar.style.width = "0%";
    return;
  }

  const perc = Math.round((processados / total) * 100);
  loteStatusEl.textContent = `Consultas em lote: ${processados}/${total} (${perc}%)`;
  loteProgressBar.style.width = perc + "%";

  if (processados >= total) {
    loteStatusEl.textContent = `Consultas em lote concluídas: ${total}/${total} (100%)`;
  }
}

// ---------- BOTÃO: ABRIR RECEITA ----------
openReceitaBtn.addEventListener("click", () => {
  const url =
    "https://servicos.receita.fazenda.gov.br/servicos/radar/consultaSituacaoCpfCnpj.asp";
  window.open(url, "_blank");
});

// ---------- IMPORTAÇÃO DA PLANILHA (LOTE VIA API) ----------
importExcelBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const cnpjs = rows
        .slice(1)
        .map((row) => normalizarCNPJ(String(row[0] || "")))
        .filter((c) => c.length > 0);

      if (!cnpjs.length) {
        alert(
          "Não foi possível encontrar CNPJs na primeira coluna da planilha."
        );
        return;
      }

      if (
        !confirm(
          `Foram encontrados ${cnpjs.length} CNPJs. Deseja iniciar a consulta em lote (via API)?`
        )
      ) {
        return;
      }

      await processarLoteCnpjs(cnpjs);
    } catch (err) {
      console.error(err);
      alert(
        "Ocorreu um erro ao ler a planilha. Verifique o arquivo e tente novamente."
      );
    } finally {
      fileInput.value = "";
    }
  };

  reader.readAsArrayBuffer(file);
});

// ---------- CONSULTA REAL VIA BACKEND ----------
async function consultarRadarPorCnpj(cnpj) {
  const resp = await fetch(
    `http://localhost:3000/consulta-radar?cnpj=${encodeURIComponent(cnpj)}`
  );

  if (!resp.ok) {
    throw new Error("Erro ao consultar backend");
  }

  const data = await resp.json();
  console.log("Resposta do backend para", cnpj, data);

  return data;
}

async function processarLoteCnpjs(cnpjs) {
  const total = cnpjs.length;
  let processados = 0;

  atualizarProgressoLote(0, total);

  for (const cnpj of cnpjs) {
    try {
      const { contribuinte, situacao, dataSituacao, submodalidade } =
        await consultarRadarPorCnpj(cnpj);

      adicionarLinhaTabela(
        cnpj,
        contribuinte,
        situacao,
        dataSituacao,
        submodalidade
      );
    } catch (err) {
      console.error("Erro ao consultar CNPJ", cnpj, err);
      adicionarLinhaTabela(cnpj, "(erro na consulta)", "ERRO", "", "");
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);
    }
  }
}

// ---------- CONSULTA UNITÁRIA (COLANDO O TEXTO) ----------
function extrairDadosDoTexto(texto) {
  const t = texto.replace(/\r/g, "");

  const contribMatch = t.match(
    /Contribuinte:\s*(.+?)\s*Situa[cç][aã]o da Habilita[cç][aã]o:/s
  );
  const sitMatch = t.match(/Situa[cç][aã]o da Habilita[cç][aã]o:\s*([^\n\r]+)/);
  const dataMatch = t.match(/Data da Situa[cç][aã]o:\s*([^\n\r]+)/);
  const subMatch = t.match(/Submodalidade:\s*([^\n\r]+)/);

  return {
    contribuinte: contribMatch ? contribMatch[1].trim() : "",
    situacao: sitMatch ? sitMatch[1].trim() : "",
    dataSituacao: dataMatch ? dataMatch[1].trim() : "",
    submodalidade: subMatch ? subMatch[1].trim() : "",
  };
}

extractAddBtn.addEventListener("click", () => {
  const cnpj = normalizarCNPJ(cnpjInput.value.trim());
  const texto = rawText.value.trim();

  if (!cnpj) {
    alert("Informe o CNPJ.");
    return;
  }
  if (!texto) {
    alert("Cole o texto da página de resultado da Receita antes de extrair.");
    return;
  }

  const { contribuinte, situacao, dataSituacao, submodalidade } =
    extrairDadosDoTexto(texto);

  if (!contribuinte || !situacao || !dataSituacao || !submodalidade) {
    alert(
      "Não foi possível encontrar todos os campos no texto colado. Confira se copiou a página inteira."
    );
    return;
  }

  adicionarLinhaTabela(
    cnpj,
    contribuinte,
    situacao,
    dataSituacao,
    submodalidade
  );

  rawText.value = "";
});

// ---------- RECONSULTAR ERROS ----------
async function reconsultarErros() {
  const erros = registros.filter((r) => {
    const sit = (r.situacao || "").toUpperCase();
    return sit === "ERRO" || r.contribuinte === "(erro na consulta)";
  });

  if (!erros.length) {
    alert("Não há registros com ERRO para reconsultar.");
    return;
  }

  if (
    !confirm(
      `Foram encontrados ${erros.length} registros com ERRO. Deseja tentar consultar novamente estes CNPJs?`
    )
  ) {
    return;
  }

  const total = erros.length;
  let processados = 0;
  atualizarProgressoLote(0, total);

  for (const reg of erros) {
    try {
      const { contribuinte, situacao, dataSituacao, submodalidade } =
        await consultarRadarPorCnpj(reg.cnpj);

      reg.contribuinte = contribuinte;
      reg.situacao = situacao;
      reg.dataSituacao = dataSituacao;
      reg.submodalidade = submodalidade;
    } catch (err) {
      console.error("Erro ao reconsultar CNPJ", reg.cnpj, err);
    } finally {
      processados++;
      atualizarProgressoLote(processados, total);
    }
  }

  salvarNoLocalStorage();
  renderizarTodos();
}

retryEr;
