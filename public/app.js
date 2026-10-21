// Interface do gerador de propostas.
const $ = (sel) => document.querySelector(sel);

const armazenamento = {
  ler(chave, padrao) {
    try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; } catch { return padrao; }
  },
  salvar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* navegador sem armazenamento */ }
  },
};

let status = { ia: false, freelancer: false, sandbox: false };
let projetoAtual = null;

// ---------- utilidades ----------

function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

let avisoTimer;
function avisar(mensagem, erro = false) {
  const el = $("#aviso");
  el.textContent = mensagem;
  el.className = "aviso" + (erro ? " erro" : "");
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), erro ? 7000 : 3500);
}

async function api(caminho, opcoes = {}) {
  const res = await fetch(caminho, {
    ...opcoes,
    headers: opcoes.body ? { "content-type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `Erro ${res.status}`);
  return data;
}

function carregando(botao, ativo, textoAtivo) {
  if (ativo) {
    botao.dataset.texto = botao.textContent;
    botao.textContent = textoAtivo;
    botao.classList.add("carregando");
    botao.disabled = true;
  } else {
    botao.textContent = botao.dataset.texto || botao.textContent;
    botao.classList.remove("carregando");
    botao.disabled = false;
  }
}

function formatarOrcamento(p) {
  if (p.orcamento) return p.orcamento;
  if (p.orcamentoMin == null && p.orcamentoMax == null) return "não informado";
  const s = p.simbolo || "";
  const faixa = p.orcamentoMax ? `${s}${p.orcamentoMin} – ${s}${p.orcamentoMax}` : `a partir de ${s}${p.orcamentoMin}`;
  return `${faixa} ${p.moeda || ""}${p.tipo === "hourly" ? " /hora" : ""}`.trim();
}

function tempoAtras(ms) {
  if (!ms) return "";
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

// ---------- abas ----------

function abrirAba(nome) {
  document.querySelectorAll(".aba").forEach((b) => {
    const ativa = b.dataset.aba === nome;
    b.classList.toggle("ativa", ativa);
    b.setAttribute("aria-selected", ativa);
  });
  document.querySelectorAll(".painel").forEach((p) => (p.hidden = p.id !== `aba-${nome}`));
  if (nome === "historico") mostrarHistorico();
  armazenamento.salvar("aba", nome);
}
document.querySelectorAll(".aba").forEach((b) => b.addEventListener("click", () => abrirAba(b.dataset.aba)));

// ---------- status ----------

async function carregarStatus() {
  try {
    status = await api("/api/status");
  } catch {
    status = { ia: false, freelancer: false };
  }
  $("#status").innerHTML = `
    <span class="pilula ${status.ia ? "ok" : ""}">IA ${status.ia ? "ligada" : "sem chave"}</span>
    <span class="pilula ${status.freelancer ? "ok" : ""}">Freelancer.com ${status.freelancer ? (status.sandbox ? "(teste)" : "conectado") : "sem token"}</span>`;
}

// ---------- perfil ----------

const camposPerfil = {
  nome: "#p-nome", habilidades: "#p-habilidades", resumo: "#p-resumo",
  portfolio: "#p-portfolio", valorHora: "#p-valor-hora", valorMinimo: "#p-valor-minimo",
};
function lerPerfil() { return armazenamento.ler("perfil", {}); }
function preencherPerfil() {
  const perfil = lerPerfil();
  for (const [chave, sel] of Object.entries(camposPerfil)) $(sel).value = perfil[chave] || "";
}
$("#form-perfil").addEventListener("submit", (e) => {
  e.preventDefault();
  const perfil = {};
  for (const [chave, sel] of Object.entries(camposPerfil)) perfil[chave] = $(sel).value.trim();
  armazenamento.salvar("perfil", perfil);
  avisar("Perfil salvo.");
});

// ---------- busca no Freelancer.com ----------

let projetosEncontrados = [];

$("#form-busca").addEventListener("submit", async (e) => {
  e.preventDefault();
  const botao = e.submitter || $("#form-busca button");
  const lista = $("#lista-projetos");
  carregando(botao, true, "Buscando…");
  try {
    const { projetos } = await api(`/api/projetos?q=${encodeURIComponent($("#termo").value.trim())}`);
    projetosEncontrados = projetos;
    const enviados = new Set(armazenamento.ler("historico", []).filter((h) => h.enviado).map((h) => String(h.projetoId)));
    lista.innerHTML = projetos.length
      ? projetos.map((p, i) => `
        <article class="cartao projeto">
          <h3>${escapar(p.titulo)}</h3>
          <div class="meta">
            <span>💰 ${escapar(formatarOrcamento(p))}</span>
            <span>📨 ${p.lances} lances</span>
            ${p.publicadoEm ? `<span>🕒 ${tempoAtras(p.publicadoEm)}</span>` : ""}
            ${enviados.has(String(p.id)) ? `<span class="selo enviado">lance enviado</span>` : ""}
          </div>
          <p class="resumo">${escapar(p.descricao.slice(0, 280))}${p.descricao.length > 280 ? "…" : ""}</p>
          ${p.habilidades ? `<div class="meta"><span>${escapar(p.habilidades)}</span></div>` : ""}
          <div class="acoes">
            <button class="btn primario" data-proposta="${i}">Escrever proposta</button>
            <a class="btn" href="${escapar(p.url)}" target="_blank" rel="noopener">Ver no site</a>
          </div>
        </article>`).join("")
      : `<p class="vazio">Nenhum projeto aberto encontrado para essa busca.</p>`;
  } catch (err) {
    lista.innerHTML = `<p class="vazio">${escapar(err.message)}</p>`;
  } finally {
    carregando(botao, false);
  }
});

$("#lista-projetos").addEventListener("click", (e) => {
  const botao = e.target.closest("[data-proposta]");
  if (botao) abrirEditor(projetosEncontrados[Number(botao.dataset.proposta)]);
});

// ---------- colar projeto ----------

$("#form-colar").addEventListener("submit", (e) => {
  e.preventDefault();
  abrirEditor({
    id: null,
    plataforma: $("#c-plataforma").value,
    titulo: $("#c-titulo").value.trim() || "Projeto sem título",
    orcamento: $("#c-orcamento").value.trim(),
    descricao: $("#c-descricao").value.trim(),
    url: null,
  });
});

// ---------- editor ----------

const editor = $("#editor");

function abrirEditor(projeto) {
  projetoAtual = projeto;
  $("#e-plataforma").textContent = projeto.plataforma;
  $("#e-titulo").textContent = projeto.titulo;
  $("#e-orcamento").textContent = `Orçamento: ${formatarOrcamento(projeto)}`;
  $("#e-moeda").textContent = projeto.moeda ? `(${projeto.moeda})` : "";
  $("#e-instrucoes").value = "";
  $("#e-resultado").hidden = true;
  $("#e-texto").value = "";
  $("#e-notas").innerHTML = "";
  $("#e-copiar").disabled = true;
  const podeEnviar = projeto.plataforma === "Freelancer.com" && projeto.id && status.freelancer;
  $("#e-enviar").hidden = !podeEnviar;
  $("#e-enviar").disabled = true;
  $("#e-link").hidden = !projeto.url;
  if (projeto.url) $("#e-link").href = projeto.url;
  $("#e-gerar").textContent = "Gerar proposta";
  editor.showModal();
  if (!lerPerfil().resumo && !lerPerfil().habilidades) {
    avisar("Dica: preencha a aba Meu perfil para propostas mais fortes.");
  }
}

$("#e-fechar").addEventListener("click", () => editor.close());

$("#e-gerar").addEventListener("click", async () => {
  const botao = $("#e-gerar");
  carregando(botao, true, "A IA está escrevendo…");
  try {
    const p = projetoAtual;
    const resultado = await api("/api/proposta", {
      method: "POST",
      body: JSON.stringify({
        perfil: lerPerfil(),
        instrucoes: $("#e-instrucoes").value,
        projeto: {
          plataforma: p.plataforma,
          titulo: p.titulo,
          descricao: p.descricao,
          orcamento: formatarOrcamento(p),
          moeda: p.moeda,
          habilidades: p.habilidades,
        },
      }),
    });
    $("#e-texto").value = resultado.proposta;
    $("#e-valor").value = Math.round(resultado.valor_sugerido) || "";
    $("#e-prazo").value = resultado.prazo_dias || "";
    const bloco = (titulo, itens) =>
      itens?.length ? `<div><h4>${titulo}</h4><ul>${itens.map((i) => `<li>${escapar(i)}</li>`).join("")}</ul></div>` : "";
    $("#e-notas").innerHTML =
      bloco("⚠️ Confira antes de enviar", resultado.pontos_de_atencao) +
      bloco("❓ Perguntas para o cliente", resultado.perguntas);
    $("#e-resultado").hidden = false;
    $("#e-copiar").disabled = false;
    $("#e-enviar").disabled = false;
    botao.dataset.texto = "Gerar outra versão";
    salvarNoHistorico(false);
  } catch (err) {
    avisar(err.message, true);
  } finally {
    carregando(botao, false);
  }
});

$("#e-copiar").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#e-texto").value);
    avisar("Proposta copiada. Cole na plataforma.");
  } catch {
    $("#e-texto").select();
    avisar("Selecionei o texto: use Ctrl+C para copiar.");
  }
});

$("#e-enviar").addEventListener("click", async () => {
  const valor = Number($("#e-valor").value);
  const prazo = Number($("#e-prazo").value);
  const texto = $("#e-texto").value.trim();
  if (!(valor > 0) || !(prazo > 0) || !texto) return avisar("Preencha proposta, valor e prazo.", true);
  const ok = confirm(`Enviar lance de ${projetoAtual.simbolo || ""}${valor} ${projetoAtual.moeda || ""} em ${prazo} dias para "${projetoAtual.titulo}"?`);
  if (!ok) return;
  const botao = $("#e-enviar");
  carregando(botao, true, "Enviando…");
  try {
    await api("/api/lance", {
      method: "POST",
      body: JSON.stringify({ projetoId: projetoAtual.id, valor, prazoDias: prazo, proposta: texto }),
    });
    salvarNoHistorico(true);
    avisar("Lance enviado no Freelancer.com!");
    editor.close();
  } catch (err) {
    avisar(err.message, true);
  } finally {
    carregando(botao, false);
  }
});

// ---------- histórico ----------

function salvarNoHistorico(enviado) {
  const historico = armazenamento.ler("historico", []);
  const chave = projetoAtual.id ? String(projetoAtual.id) : projetoAtual.titulo;
  const item = {
    chave,
    projetoId: projetoAtual.id,
    plataforma: projetoAtual.plataforma,
    titulo: projetoAtual.titulo,
    url: projetoAtual.url,
    proposta: $("#e-texto").value,
    valor: $("#e-valor").value,
    moeda: projetoAtual.moeda || "",
    prazo: $("#e-prazo").value,
    enviado,
    data: Date.now(),
  };
  const anterior = historico.findIndex((h) => h.chave === chave);
  if (anterior >= 0) {
    item.enviado = enviado || historico[anterior].enviado;
    historico.splice(anterior, 1);
  }
  historico.unshift(item);
  armazenamento.salvar("historico", historico.slice(0, 100));
}

function mostrarHistorico() {
  const historico = armazenamento.ler("historico", []);
  $("#lista-historico").innerHTML = historico.length
    ? historico.map((h, i) => `
      <article class="cartao projeto">
        <h3>${escapar(h.titulo)}</h3>
        <div class="meta">
          <span class="selo">${escapar(h.plataforma)}</span>
          <span class="selo ${h.enviado ? "enviado" : ""}">${h.enviado ? "lance enviado" : "rascunho"}</span>
          <span>${new Date(h.data).toLocaleString("pt-BR")}</span>
          ${h.valor ? `<span>💰 ${escapar(h.valor)} ${escapar(h.moeda)} · ${escapar(h.prazo)} dias</span>` : ""}
        </div>
        <p class="resumo">${escapar(h.proposta.slice(0, 240))}${h.proposta.length > 240 ? "…" : ""}</p>
        <div class="acoes">
          <button class="btn" data-copiar="${i}">Copiar proposta</button>
          ${h.url ? `<a class="btn" href="${escapar(h.url)}" target="_blank" rel="noopener">Ver projeto</a>` : ""}
        </div>
      </article>`).join("")
    : `<p class="vazio">Nenhuma proposta ainda. Gere a primeira nas abas Buscar ou Colar projeto.</p>`;
}

$("#lista-historico").addEventListener("click", async (e) => {
  const botao = e.target.closest("[data-copiar]");
  if (!botao) return;
  const item = armazenamento.ler("historico", [])[Number(botao.dataset.copiar)];
  try {
    await navigator.clipboard.writeText(item.proposta);
    avisar("Proposta copiada.");
  } catch {
    avisar("Não consegui copiar automaticamente.", true);
  }
});

// ---------- início ----------

preencherPerfil();
abrirAba(armazenamento.ler("aba", "buscar"));
carregarStatus();
