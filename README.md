# Propostas Freelancer

Site simples para encontrar projetos de desenvolvimento de sites e enviar propostas escritas com IA (Claude).

- **Buscar projetos** — lista projetos abertos no **Freelancer.com** pela API oficial.
- **Escrever proposta** — a IA lê o projeto e o seu perfil e sugere texto, valor e prazo, além de perguntas para o cliente e pontos de atenção.
- **Enviar lance** — no Freelancer.com o lance é enviado direto pela API, **sempre depois da sua revisão e confirmação**.
- **Colar projeto** — para Workana, 99Freelas, Upwork e outras: cole a descrição, gere a proposta e copie o texto para a plataforma.
- **Histórico** — guarda as propostas geradas e enviadas neste navegador.

## Por que algumas plataformas são "copiar e colar"

| Plataforma | API para enviar propostas? |
| --- | --- |
| Freelancer.com | Sim, API aberta (busca + lances) |
| Upwork | Só para apps aprovados pela Upwork, e o envio automático de propostas não é permitido |
| Workana | Não tem API pública |
| 99Freelas | Não tem API pública |

Enviar propostas por robô nessas plataformas viola os termos de uso e pode bloquear sua conta, por isso nelas o site gera o texto e você cola.

## Como rodar

Precisa do **Node.js 20.12 ou mais novo**.

```bash
git clone https://github.com/ViniciusRisse/api.freelancers
cd api.freelancers
npm install
cp .env.example .env   # e preencha as chaves
npm start
# abra http://localhost:3000
```

### Chaves

| Variável | Onde conseguir |
| --- | --- |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `FREELANCER_TOKEN` | [accounts.freelancer.com/settings/develop](https://accounts.freelancer.com/settings/develop) → crie um app e gere um token com os escopos *basic* e *advanced* |
| `FREELANCER_API` | `https://www.freelancer.com` (real) ou `https://www.freelancer-sandbox.com` (testes, sem lances de verdade) |

As chaves ficam só no servidor (`.env`), nunca no navegador. O arquivo `.env` está no `.gitignore`.

Dica: comece com o sandbox do Freelancer.com para testar o envio sem gastar lances reais.

## Primeiro uso

1. Abra a aba **Meu perfil** e preencha resumo, habilidades, portfólio e valores. A IA só usa o que estiver ali, nunca inventa experiência.
2. Em **Buscar projetos**, procure por "website", "wordpress", "landing page" etc.
3. Clique em **Escrever proposta**, revise o texto, o valor e o prazo, e clique em **Enviar lance**.

## Publicar

Como o site tem um pequeno servidor (para proteger as chaves), ele não roda no GitHub Pages. Use um serviço que rode Node.js, como Render, Railway ou Fly.io: comando de início `npm start` e as variáveis do `.env` configuradas no painel do serviço.

Se publicar na internet, preencha `SENHA` no `.env`: o navegador vai pedir a senha ao abrir o site (o usuário pode ser qualquer um). Sem isso, qualquer pessoa com o link poderia enviar lances na sua conta.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `server.js` | Servidor: chama o Claude e a API do Freelancer.com |
| `public/index.html` | Página |
| `public/style.css` | Visual (paleta areia, com modo escuro) |
| `public/app.js` | Busca, editor da proposta, perfil e histórico |
