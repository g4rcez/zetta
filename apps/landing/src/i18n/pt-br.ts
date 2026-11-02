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
      examples: "Exemplos",
      features: "Recursos",
      selfHost: "Hospedar",
    },
    github: "Dar uma estrela no GitHub",
    cta: "Hospedar",
    switchLabel: "EN",
    switchName: "English",
    switchHref: "/",
  },
  hero: {
    title: "Peça o resultado. Seu chief cuida do resto.",
    lead: "Zetta é um app web open source que você hospeda por conta própria. Cada pessoa tem um chief pessoal. Diga ao seu chief o que você precisa. Ele coordena bots especialistas no seu servidor. Você volta para o resultado, ou para a única coisa que precisa de você.",
    primary: "Hospedar o Zetta",
    secondary: "Dar uma estrela no GitHub",
    note: "Código aberto sob a licença MIT. Roda no seu servidor.",
    hub: {
      label: "Exemplo ilustrativo",
      description:
        "Ilustração: você pede um resultado ao seu chief. O chief chama três bots especialistas. Os bots rodam nos seis agentes instalados no seu servidor. Um bot espera a sua aprovação.",
      you: "Você",
      ask: "Envie o resumo semanal para o time",
      chief: "Zetta",
      chiefRole: "Seu chief",
      botsTitle: "Bots especialistas",
      agentsTitle: "Agentes no seu servidor",
      needs: "Precisa de você",
      writing: "Escrevendo o resumo",
      bots: [
        { name: "Writer", status: "Enviar para toda a lista do time?", kind: "needs" },
        { name: "Reviewer", status: "Lendo pull requests", kind: "working" },
        { name: "Researcher", status: "Reunindo fontes", kind: "working" },
      ],
      agents: ["Pi", "Codex", "OMP", "Claude Code", "OpenCode", "Cursor"],
    },
  },
  demo: {
    title: "Veja uma execução do começo ao fim",
    lead: "Três execuções de exemplo. Uma termina. Duas param e chamam você.",
    pause: "Pausar",
    resume: "Continuar",
    label: "Exemplos de execução",
    tabsLabel: "Escolha um exemplo",
    replay: "Repetir",
    illustrated: "Exemplo ilustrativo",
    working: "Trabalhando…",
    you: "Você",
    tabs: [
      {
        id: "briefing",
        label: "Resumo da manhã",
        pitch: "Uma rotina lê sua agenda e seus pull requests antes de você abrir o notebook.",
        user: "Todo dia útil às 8h, me resuma minha agenda, os pull requests abertos e tudo que estiver bloqueado.",
        chief: "Pronto. Criei uma rotina e pedi ao Reviewer ajuda com os pull requests.",
        steps: [
          "Leu a agenda de hoje",
          "Listou os pull requests abertos",
          "Resumiu as tarefas bloqueadas",
        ],
        outcome: {
          kind: "done",
          title: "Rotina criada",
          body: "Primeiro resumo: 3 reuniões, 2 pull requests esperando, 1 tarefa bloqueada.",
        },
      },
      {
        id: "review",
        label: "Revisão de código",
        pitch:
          "Um bot começa o trabalho, encontra um login bloqueado e pergunta a você em vez de adivinhar.",
        user: "Revise o novo pull request de autenticação procurando problemas de segurança.",
        chief: "Pedi ao Reviewer. Ele começou e encontrou um problema.",
        steps: ["Abriu o pull request", "Leu os arquivos alterados"],
        outcome: {
          kind: "needs",
          title: "Bloqueado: login do GitHub expirou",
          body: "O Reviewer não consegue ler os próximos arquivos. Entre no GitHub de novo e ele continua daqui.",
          actions: ["Entrar de novo", "Parar a tarefa"],
        },
      },
      {
        id: "newsletter",
        label: "Newsletter semanal",
        pitch: "Um bot escreve o rascunho. Enviar e-mail espera o seu sim.",
        user: "Escreva a newsletter de sexta com as atualizações da semana.",
        chief: "O Writer tem um rascunho. Enviar e-mail precisa da sua aprovação.",
        steps: ["Reuniu as atualizações da semana", "Escreveu a newsletter", "Conferiu os links"],
        outcome: {
          kind: "needs",
          title: "Precisa de você: enviar e-mail",
          body: "Enviar a newsletter para toda a lista do time?",
          actions: ["Aprovar", "Recusar"],
        },
      },
    ],
  },
  features: {
    title: "O que seus bots podem fazer",
    lead: "Tudo abaixo existe hoje no repositório. Ações comuns rodam sozinhas. Um resultado bloqueado ou incerto sempre volta para você.",
    scenes: {
      chats: ["Resumo semanal", "Newsletter de sexta", "Notas do lançamento"],
      room: "lancamento",
      days: ["Seg", "Ter", "Qua", "Qui", "Sex"],
      routine: "Resumo",
      routine2: "Newsletter",
      columns: ["Trabalhando", "Precisa de você", "Feito"],
      tasks: ["Revisar o pull request de autenticação", "Enviar a newsletter", "Resumo da manhã"],
      pages: ["Changelog", "Página de status", "Novidades do time"],
    },
    items: [
      {
        title: "Chats e salas",
        body: "Cada bot tem vários chats. Abra um chat novo para cada intenção, assim o contexto fica limpo e o trabalho é fácil de achar. Salas colocam vários bots e pessoas na mesma conversa.",
        tags: [],
      },
      {
        title: "Rotinas e agenda",
        body: "Agende trabalho para rodar sem você. A agenda sincroniza nos dois sentidos com o calendário principal de cada conta Google que você conectar.",
        tags: ["Google Agenda"],
      },
      {
        title: "Atenção e tarefas",
        body: "Uma caixa de entrada para o que está trabalhando, o que precisa de resposta, o que está bloqueado e o que tem resultado novo. Apagar arquivos, rodar como administrador e enviar e-mail esperam por você. Nada aparece como feito quando não está.",
        tags: [],
      },
      {
        title: "Navegador e computador",
        body: "Bots podem usar um navegador ou um desktop Linux que roda no seu servidor, com limites de memória, CPU e de quantos rodam ao mesmo tempo.",
        tags: [],
      },
      {
        title: "Apps conectados",
        body: "Adicione GitHub, Linear, Notion, Sentry, PostHog, Cloudflare e outros pelo Studio. Google Agenda, Gmail e Drive também são suportados.",
        tags: ["GitHub", "Linear", "Notion", "Sentry", "PostHog", "Cloudflare", "Gmail", "Drive"],
      },
      {
        title: "Telegram e WhatsApp",
        body: "Fale com seus bots pelo Telegram com o token do seu próprio bot, ou pelo WhatsApp usando o seu próprio servidor WAHA. O envio pelo WhatsApp fica desligado até você ligar.",
        tags: ["Telegram", "WhatsApp"],
      },
      {
        title: "Memória e conhecimento",
        body: "Os bots guardam o que importa entre chats. O conhecimento da empresa é pesquisável e pode rodar com um modelo de embeddings local.",
        tags: [],
      },
      {
        title: "Suas ferramentas de código",
        body: "Claude Code ou Cursor podem agir como membro do time pelo servidor MCP embutido. Ele usa as mesmas checagens de permissão do app web.",
        tags: ["Claude Code", "Cursor"],
      },
      {
        title: "Os agentes que você já usa",
        body: "O servidor roda Pi, Codex, OMP, Claude Code, OpenCode e Cursor. Cada bot pode usar um diferente.",
        tags: ["Pi", "Codex", "OMP", "Claude Code", "OpenCode", "Cursor"],
      },
    ],
  },
  selfHost: {
    title: "Rode no seu servidor",
    lead: "Você precisa de Git e Docker. O Zetta sobe um app web, uma API e um banco Postgres.",
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
    docs: "Ler a documentação no GitHub",
    note: "Gratuito sob a licença MIT. Ainda é inicial: leia o repositório e as issues antes de depender dele.",
    mock: { address: "localhost:3001", inbox: "Caixa de entrada", bots: "Bots" },
  },
  cta: {
    title: "Gostou do rumo? Dê uma estrela no Zetta no GitHub.",
    lead: "Uma estrela ajuda outros times a achar o projeto. Issues e pull requests também são bem-vindos.",
    primary: "Dar uma estrela no GitHub",
    secondary: "Abrir uma issue",
    repo: "github.com/g4rcez/zetta",
  },
  footer: {
    tagline: "Bots que trabalham no seu servidor enquanto você faz outra coisa.",
    license: "Licença MIT",
    links: { repo: "Repositório", docs: "Docs", issues: "Issues" },
    columns: { product: "Produto", developers: "Desenvolvedores", language: "Idioma" },
  },
} satisfies Copy;
