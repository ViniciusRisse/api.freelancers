// Servidor do gerador de propostas.
// Serve a página em public/ e faz a ponte com o Claude e o Freelancer.com,
// para que as chaves de API fiquem só no servidor (nunca no navegador).

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, "public");
const PORT = Number(process.env.PORT) || 3000;
const FREELANCER_API = (process.env.FREELANCER_API || "https://www.freelancer.com").replace(/\/$/, "");
const FREELANCER_TOKEN = process.env.FREELANCER_TOKEN || "";
const MODEL = "claude-opus-5-5";
const SENHA = process.env.SENHA || "";

const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

// ---------- IA: gerar proposta ----------

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    proposta: { type: "string", description: "Texto da proposta, pronto para enviar ao cliente." },
    valor_sugerido: { type: "number", description: "Valor sugerido do lance, na moeda do projeto." },
    prazo_dias: { type: "integer", description: "Prazo de entrega sugerido, em dias." },
    perguntas: {
      type: "array",
      items: { type: "string" },
      description: "Perguntas úteis para esclarecer com o cliente.",
    },
    pontos_de_atencao: {
      type: "array",
      items: { type: "string" },
      description: "Riscos ou detalhes do projeto que o freelancer deve conferir antes de enviar.",
    },
  },
  required: ["proposta", "valor_sugerido", "prazo_dias", "perguntas", "pontos_de_atencao"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Você escreve propostas para projetos de desenvolvimento de sites em plataformas de freelancers (Freelancer.com, Workana, 99Freelas, Upwork e similares) em nome do freelancer cujo perfil é informado.

Como escrever uma boa proposta:
- Comece mostrando que leu o projeto: cite o objetivo do cliente com suas palavras, nada de saudação genérica.
- Explique em poucos passos como vai fazer o site (tecnologias, etapas, o que será entregue).
- Use só experiências, habilidades e links que aparecem no perfil. Nunca invente portfólio, clientes, avaliações ou certificados.
- Seja direto: de 120 a 220 palavras, parágrafos curtos, tom profissional e próximo.
- Termine com uma pergunta ou próximo passo claro.
- Escreva no idioma do projeto (se o projeto estiver em inglês, escreva em inglês).

Valor e prazo: respeite a faixa de orçamento do projeto quando houver, levando em conta o valor/hora e o valor mínimo do perfil. Se o orçamento for baixo demais para o escopo, aponte isso em pontos_de_atencao.`;

async function gerarProposta({ projeto, perfil, instrucoes }) {
  if (!claude) throw new HttpError(500, "Configure ANTHROPIC_API_KEY no arquivo .env para usar a IA.");
  if (!projeto?.descricao?.trim()) throw new HttpError(400, "Informe a descrição do projeto.");

  const linhas = [
    "## Perfil do freelancer",
    `Nome: ${perfil?.nome || "(não informado)"}`,
    `Resumo: ${perfil?.resumo || "(não informado)"}`,
    `Habilidades: ${perfil?.habilidades || "(não informado)"}`,
    `Portfólio / links: ${perfil?.portfolio || "(nenhum)"}`,
    `Valor por hora: ${perfil?.valorHora || "(não informado)"}`,
    `Valor mínimo por projeto: ${perfil?.valorMinimo || "(não informado)"}`,
    "",
    "## Projeto",
    `Plataforma: ${projeto.plataforma || "não informada"}`,
    `Título: ${projeto.titulo || "(sem título)"}`,
    `Orçamento: ${projeto.orcamento || "não informado"}`,
    `Moeda: ${projeto.moeda || "não informada"}`,
    `Habilidades pedidas: ${projeto.habilidades || "não informadas"}`,
    "Descrição:",
    projeto.descricao,
  ];
  if (instrucoes?.trim()) linhas.push("", "## Pedido extra do freelancer para esta proposta", instrucoes);

  const response = await claude.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: PROPOSAL_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: linhas.join("\n") }],
  });

  if (response.stop_reason === "refusal") {
    throw new HttpError(422, "A IA não quis escrever essa proposta. Revise a descrição do projeto.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new HttpError(502, "A resposta da IA ficou incompleta. Tente de novo.");
  }
  const texto = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return JSON.parse(texto);
  } catch {
    throw new HttpError(502, "A IA respondeu num formato inesperado. Tente de novo.");
  }
}

// ---------- Freelancer.com ----------

async function freelancer(caminho, { method = "GET", body } = {}) {
  if (!FREELANCER_TOKEN) {
    throw new HttpError(500, "Configure FREELANCER_TOKEN no arquivo .env para usar o Freelancer.com.");
  }
  const res = await fetch(`${FREELANCER_API}/api${caminho}`, {
    method,
    headers: {
      "freelancer-oauth-v1": FREELANCER_TOKEN,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === "error") {
    throw new HttpError(res.ok ? 502 : res.status, `Freelancer.com: ${data.message || res.statusText}`);
  }
  return data.result;
}

let meuIdFreelancer = null;
async function meuId() {
  if (!meuIdFreelancer) meuIdFreelancer = (await freelancer("/users/0.1/self/")).id;
  return meuIdFreelancer;
}

async function buscarProjetos(busca) {
  const params = new URLSearchParams({
    query: busca || "website",
    limit: "20",
    full_description: "true",
    job_details: "true",
    compact: "true",
  });
  const result = await freelancer(`/projects/0.1/projects/active/?${params}`);
  return (result.projects || []).map((p) => ({
    id: p.id,
    plataforma: "Freelancer.com",
    titulo: p.title,
    descricao: p.description || p.preview_description || "",
    orcamentoMin: p.budget?.minimum ?? null,
    orcamentoMax: p.budget?.maximum ?? null,
    moeda: p.currency?.code || "USD",
    simbolo: p.currency?.sign || "$",
    tipo: p.type, // "fixed" ou "hourly"
    lances: p.bid_stats?.bid_count ?? 0,
    mediaLances: p.bid_stats?.bid_avg ?? null,
    habilidades: (p.jobs || []).map((j) => j.name).join(", "),
    publicadoEm: p.time_submitted ? p.time_submitted * 1000 : null,
    url: p.seo_url ? `${FREELANCER_API}/projects/${p.seo_url}` : `${FREELANCER_API}/projects/${p.id}`,
  }));
}

async function enviarLance({ projetoId, valor, prazoDias, proposta }) {
  if (!projetoId || !(valor > 0) || !(prazoDias > 0) || !proposta?.trim()) {
    throw new HttpError(400, "Preencha projeto, valor, prazo e texto da proposta.");
  }
  const bid = await freelancer("/projects/0.1/bids/", {
    method: "POST",
    body: {
      project_id: Number(projetoId),
      bidder_id: await meuId(),
      amount: Number(valor),
      period: Number(prazoDias),
      milestone_percentage: 100,
      description: proposta,
    },
  });
  return { id: bid.id };
}

// ---------- HTTP ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function lerCorpo(req) {
  let texto = "";
  for await (const parte of req) {
    texto += parte;
    if (texto.length > 200_000) throw new HttpError(413, "Requisição grande demais.");
  }
  try {
    return texto ? JSON.parse(texto) : {};
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

// Senha opcional (variável SENHA): o navegador pede usuário e senha; o usuário pode ser qualquer um.
function senhaCorreta(req) {
  const [tipo, valor] = (req.headers.authorization || "").split(" ");
  if (tipo !== "Basic" || !valor) return false;
  const senha = Buffer.from(valor, "base64").toString().split(":").slice(1).join(":");
  const a = Buffer.from(senha);
  const b = Buffer.from(SENHA);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function arquivoEstatico(res, pathname) {
  const destino = path.normalize(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
  if (!destino.startsWith(PUBLIC_DIR)) throw new HttpError(404, "Não encontrado.");
  try {
    const conteudo = await fs.readFile(destino);
    res.writeHead(200, { "content-type": TIPOS[path.extname(destino)] || "application/octet-stream" });
    res.end(conteudo);
  } catch {
    throw new HttpError(404, "Não encontrado.");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (SENHA && !senhaCorreta(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="Propostas", charset="UTF-8"' });
    return res.end("Senha necessaria.");
  }
  try {
    if (url.pathname === "/api/status" && req.method === "GET") {
      return json(res, 200, {
        ia: Boolean(claude),
        freelancer: Boolean(FREELANCER_TOKEN),
        sandbox: FREELANCER_API.includes("sandbox"),
      });
    }
    if (url.pathname === "/api/projetos" && req.method === "GET") {
      return json(res, 200, { projetos: await buscarProjetos(url.searchParams.get("q")) });
    }
    if (url.pathname === "/api/proposta" && req.method === "POST") {
      return json(res, 200, await gerarProposta(await lerCorpo(req)));
    }
    if (url.pathname === "/api/lance" && req.method === "POST") {
      return json(res, 200, await enviarLance(await lerCorpo(req)));
    }
    if (url.pathname.startsWith("/api/")) throw new HttpError(404, "Rota não encontrada.");
    if (req.method !== "GET") throw new HttpError(405, "Método não permitido.");
    await arquivoEstatico(res, url.pathname);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status >= 500) console.error(err.message);
      return json(res, err.status, { erro: err.message });
    }
    console.error(err);
    if (err instanceof Anthropic.AuthenticationError) {
      return json(res, 500, { erro: "A chave ANTHROPIC_API_KEY é inválida." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return json(res, 429, { erro: "Limite de uso da IA atingido. Espere um pouco e tente de novo." });
    }
    if (err instanceof Anthropic.APIError) {
      return json(res, 502, { erro: `Erro na API do Claude: ${err.message}` });
    }
    json(res, 500, { erro: "Erro inesperado. Veja o terminal do servidor." });
  }
});

server.listen(PORT, () => {
  console.log(`Gerador de propostas rodando em http://localhost:${PORT}`);
  if (!claude) console.log("Aviso: ANTHROPIC_API_KEY não configurada — a IA ficará desligada.");
  if (!FREELANCER_TOKEN) console.log("Aviso: FREELANCER_TOKEN não configurado — a busca no Freelancer.com ficará desligada.");
});
