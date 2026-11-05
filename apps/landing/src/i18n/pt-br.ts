import type { Copy } from "./en";

export const ptBr = {
  meta: {
    title: "Zetta: bots que trabalham no seu servidor enquanto você faz outra coisa",
    description:
      "Zetta é um espaço de trabalho open source e auto-hospedado para bots. Peça um resultado ao seu chief. Volte para o resultado, ou para a única coisa que precisa de você.",
  },
  header: {
    home: "Início do Zetta",
    nav: {
      product: "Produto",
      network: "Integrações",
      selfHost: "Hospedar",
    },
    github: "Deixa o like",
    switchLabel: "EN",
    switchName: "English",
    switchHref: "/",
  },
  hero: {
    title: "Peça o resultado. Seu chief cuida do resto.",
    lead: "Zetta é um app web open source que você hospeda por conta própria. Dê um trabalho ao seu chief pessoal, como um resumo semanal ou a revisão de um pull request. Ele passa o serviço a bots especialistas no seu servidor, e você volta para o resultado, ou para a única pergunta que ele não resolve sozinho.",
    primary: "Hospedar o Zetta",
    secondary: "Deixa o like",
    note: "Código aberto sob a licença MIT. Roda no seu servidor.",
    installLabel: "macOS, Linux, WSL",
    copy: "Copiar",
    copied: "Copiado",
    screenAlt:
      "O chat do Zetta no modo claro: o chief responde que chamou três bots, e um parou para perguntar antes de enviar. Dados de demonstração.",
  },
  product: {
    title: "Veja o que seus bots fizeram e o que eles precisam de você",
    note: "Capturas do Zetta no modo claro, com dados de demonstração.",
    rows: [
      {
        id: "inbox",
        title: "Seus bots só perguntam quando precisam de você",
        body: "A caixa de entrada lista o que está trabalhando, o que está bloqueado e o que tem resultado novo. Apagar arquivos, comandos de administrador e enviar e-mail esperam a sua aprovação. Uma tarefa só é marcada como feita quando está feita.",
        alt: "A caixa de entrada lista dois itens que precisam de você: enviar a newsletter para toda a lista do time e um login do GitHub bloqueado. Dados de demonstração.",
      },
      {
        id: "chat",
        title: "Um chat para cada intenção",
        body: "Cada bot guarda vários chats, um para cada intenção, assim o contexto fica limpo e você acha o trabalho depois. Salas colocam vários bots e pessoas na mesma conversa.",
        alt: "Um chat com o bot Writer. O rascunho da newsletter termina com uma pergunta que espera aprovação. Dados de demonstração.",
      },
      {
        id: "tasks",
        title: "Quem está com o quê, e o que travou",
        body: "As tarefas passam de backlog para em andamento, bloqueado, revisão e feito. Cada cartão mostra o bot responsável, então o trabalho bloqueado salta aos olhos.",
        alt: "O quadro de tarefas com as colunas backlog, em andamento, bloqueado e revisão, cada cartão com o seu bot. Dados de demonstração.",
      },
      {
        id: "routines",
        title: "Trabalho que começa sem você",
        body: "Agende um resumo, uma newsletter ou uma fila de revisão para rodar sozinha. A agenda sincroniza nos dois sentidos com o calendário principal de cada conta Google que você conectar.",
        alt: "A página de rotinas: um resumo da manhã, uma newsletter de sexta e uma fila de pull requests, cada uma com a próxima execução. Dados de demonstração.",
      },
    ],
  },
  network: {
    title: "Conecte as contas e os agentes que você já tem",
    lead: "Tudo abaixo existe hoje no repositório. Ações comuns rodam sozinhas. Um resultado bloqueado ou incerto sempre volta para você.",
    items: [
      {
        title: "Apps conectados",
        body: "Conecte pelo Studio as contas que seus bots precisam. Compartilhar um bot nunca compartilha as suas credenciais.",
        tags: ["GitHub", "Linear", "Notion", "Sentry", "PostHog", "Cloudflare", "Gmail", "Drive"],
      },
      {
        title: "Telegram e WhatsApp",
        body: "Mande mensagens aos seus bots pelo Telegram, com o token do seu próprio bot, ou pelo WhatsApp, usando o seu próprio servidor WAHA. O envio pelo WhatsApp fica desligado até você ligar.",
        tags: ["Telegram", "WhatsApp"],
      },
      {
        title: "Suas ferramentas de código",
        body: "Claude Code ou Cursor podem trabalhar como membros do seu time por uma conexão embutida, com as mesmas checagens de permissão do app web.",
        tags: ["Claude Code", "Cursor"],
      },
      {
        title: "Os agentes que você já usa",
        body: "O servidor roda Pi, Codex, OMP, Claude Code, OpenCode e Cursor. Cada bot pode usar um diferente.",
        tags: ["Pi", "Codex", "OMP", "Claude Code", "OpenCode", "Cursor"],
      },
      {
        title: "Navegador e computador",
        body: "Bots podem usar um navegador ou um desktop Linux no seu servidor. Num login, uma pessoa assume o controle e o bot segue depois. Você define limites de memória, CPU e de quantos rodam ao mesmo tempo.",
        tags: [],
      },
      {
        title: "Memória e conhecimento",
        body: "Os bots guardam o que importa entre chats. O conhecimento da empresa é pesquisável, até com um modelo de embeddings local.",
        tags: [],
      },
    ],
  },
  selfHost: {
    title: "Rode no seu servidor",
    lead: "Você precisa de Git e Docker. O Zetta sobe um app web, uma API e um banco Postgres.",
    note: "Gratuito sob a licença MIT. Ainda é inicial: leia o repositório e as issues antes de depender dele.",
    docs: "Ler a documentação no GitHub",
    steps: [
      { title: "Baixe o código", body: "Clone o repositório." },
      {
        title: "Crie as configurações",
        body: "Escreva os dois arquivos .env. Este comando gera os segredos para você. A lista completa de configurações está em apps/server/.env.schema.",
      },
      { title: "Suba tudo", body: "Construa e inicie os três containers." },
      {
        title: "Termine a configuração no navegador",
        body: "Abra http://localhost:3001 e cole a chave de setup de apps/server/.env. Você vira o admin desta instalação.",
      },
    ],
    copy: "Copiar",
    copied: "Copiado",
    last: {
      title: "Ajude outros times a encontrar o Zetta",
      body: "Uma estrela no GitHub é a forma mais rápida de ajudar. Issues e pull requests também são bem-vindos.",
      primary: "Deixa o like",
      secondary: "Abrir uma issue",
      repo: "github.com/g4rcez/zetta",
    },
  },
  footer: {
    tagline: "Bots que trabalham no seu servidor enquanto você faz outra coisa.",
    license: "Licença MIT",
    links: { repo: "Repositório", docs: "Docs", issues: "Issues" },
  },
} satisfies Copy;
