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
      how: "Como funciona",
      features: "O que faz",
      control: "Controle",
      selfHost: "Hospedar",
      faq: "Perguntas",
    },
    github: "GitHub",
    cta: "Hospedar",
    switchLabel: "EN",
    switchName: "English",
    switchHref: "/",
  },
  hero: {
    title: "Peça o resultado. Seu chief cuida do resto.",
    lead: "Zetta é um espaço de trabalho auto-hospedado para bots. Diga ao seu chief o que você precisa. Ele coordena bots especialistas no seu servidor, e você volta para o resultado, ou para a única coisa que precisa de você.",
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
  strip: {
    title: "Conecte os apps que seu time já usa",
    label: "Apps e canais",
    pause: "Pausar",
    play: "Continuar",
  },
  how: {
    title: "Você pede. O trabalho acontece no servidor.",
    lead: "Feche a aba. Os bots rodam no seu servidor, não no navegador. O Zetta só chama você quando uma pessoa é necessária.",
    steps: [
      {
        title: "Peça ao seu chief",
        body: "Escreva o resultado em palavras simples. Sem configuração, sem engenharia de prompt.",
      },
      {
        title: "O chief delega",
        body: "Ele escolhe bots especialistas, ou pede que você crie um.",
      },
      {
        title: "Os bots trabalham no servidor",
        body: "Rotinas, plugins, um navegador ou um desktop Linux. Você pode fechar a aba.",
      },
      {
        title: "Você só é chamado quando precisa",
        body: "Um detalhe faltando, um login expirado, uma ação de risco. A caixa de entrada mostra.",
      },
      {
        title: "Você recebe o resultado",
        body: "Um resumo do que rodou e a lista das ações que o bot fez.",
      },
    ],
    vignettes: {
      inbox: "Caixa de entrada",
      delegate: ["O chief chamou o Writer", "O chief chamou o Reviewer"],
      server: [
        "Rotina: todo dia útil às 08:00",
        "Navegador: lendo 3 páginas",
        "Aba fechada, ainda rodando",
      ],
      actions: "6 ações",
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
  },
  features: {
    title: "O que seus bots podem fazer",
    lead: "Tudo abaixo existe hoje no repositório. Onde algo ainda é inicial, as perguntas frequentes avisam.",
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
        body: "Uma caixa de entrada para o que está trabalhando, o que precisa de resposta, o que está bloqueado e o que tem resultado novo. Um kanban mostra as mesmas tarefas em colunas.",
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
  control: {
    title: "Autonomia que não finge",
    lead: "O Zetta não pede aprovação a cada passo, e não informa um sucesso que não aconteceu.",
    points: [
      {
        title: "Sem falso sucesso",
        body: "Informação faltando, logins expirados, ferramentas bloqueadas e resultados incertos aparecem na sua caixa de entrada. Nunca ficam escondidos atrás de um check verde.",
      },
      {
        title: "Aprovação só onde importa",
        body: "Ações comuns rodam sozinhas. Apagar arquivos, rodar como administrador e enviar e-mail esperam por você.",
      },
      {
        title: "O compartilhamento termina no bot",
        body: "Colegas podem usar um bot que você compartilha. Suas conversas, credenciais, arquivos e memórias continuam suas.",
      },
      {
        title: "O servidor decide",
        body: "Login e permissões são checados no servidor. Há um admin por instalação, e ser admin não abre chats privados.",
      },
    ],
    scenes: {
      honest: {
        rows: [
          { label: "Bloqueado", text: "Login do GitHub expirou", kind: "blocked" },
          {
            label: "Precisa de você",
            text: "Enviar a newsletter para toda a lista do time?",
            kind: "needs",
          },
          {
            label: "Resultado novo",
            text: "Rotina criada. O primeiro resumo está pronto.",
            kind: "result",
          },
        ],
      },
      approval: {
        ran: "Rodou sozinho",
        waits: "Espera por você",
        rows: [
          { text: "Leu 12 atualizações", kind: "ran" },
          { text: "Abriu uma aba do navegador", kind: "ran" },
          { text: "Enviar e-mail para a lista do time", kind: "waits" },
          { text: "Apagar arquivos", kind: "waits" },
        ],
      },
      sharing: {
        bot: "Writer",
        shared: "Compartilhado com o time",
        stays: "Só com você",
        items: ["Suas conversas", "Credenciais", "Arquivos", "Memórias"],
      },
      server: {
        title: "Checado no servidor",
        allowed: "Permitido",
        denied: "Negado",
        rows: [
          { text: "Abrir o bot Writer compartilhado", kind: "allowed" },
          { text: "Ler o chat privado de outra pessoa", kind: "denied" },
        ],
      },
    },
  },
  teams: {
    title: "Para times com e sem engenheiros",
    lead: "Cada pessoa tem um chief pessoal. Bots, workspaces e papéis mantêm o time organizado.",
    scene: {
      workspace: "Lançamento",
      people: "Pessoas",
      bots: "Bots",
      roles: ["Admin", "Membro", "Membro"],
      team: "Time",
      private: "Privado",
    },
    items: [
      {
        title: "Linguagem simples por padrão",
        body: "Configure um bot com um formulário, ou conversando com ele. Um bot só fica pronto depois de um chat de teste de verdade e do seu sim.",
      },
      {
        title: "Avançado quando você quiser",
        body: "Modelos, agentes, apps conectados e permissões têm controles próprios para quem precisa deles.",
      },
      {
        title: "Workspaces e papéis",
        body: "Agrupe bots em workspaces. Os bots ficam visíveis ao time por padrão, e podem ser privados.",
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
    mock: { address: "localhost:3001", inbox: "Caixa de entrada", bots: "Bots" },
  },
  faq: {
    title: "Perguntas",
    items: [
      {
        q: "O que é o Zetta?",
        a: "Um app web que você hospeda para gerenciar bots autônomos. Cada pessoa tem um chief pessoal. Você dá um resultado ao chief, e ele coordena bots especialistas no servidor.",
      },
      {
        q: "Preciso saber programar?",
        a: "Não. Você configura um bot com um formulário ou conversando com ele. As opções técnicas estão lá quando você quiser.",
      },
      {
        q: "Quais modelos e agentes ele usa?",
        a: "O servidor roda os agentes instalados nele: Pi, Codex, OMP, Claude Code, OpenCode e Cursor. Cada um entra no seu próprio provedor, então você traz essas contas.",
      },
      {
        q: "Onde ficam meus dados e chaves?",
        a: "No seu servidor, no seu Postgres. Os segredos guardados são criptografados com uma chave que você define. Compartilhar um bot nunca compartilha conversas, credenciais, arquivos ou memórias.",
      },
      {
        q: "O bot pergunta tudo para mim?",
        a: "Não. Ações comuns rodam sozinhas. Apagar arquivos, rodar como administrador e enviar e-mail esperam a sua aprovação, e um resultado bloqueado ou incerto volta para você.",
      },
      {
        q: "Posso usar pelo Telegram ou WhatsApp?",
        a: "O Telegram funciona com o seu próprio bot do BotFather. O WhatsApp funciona por um servidor WAHA que você roda, pareado com QR code. O envio pelo WhatsApp vem desligado.",
      },
      {
        q: "Quanto custa?",
        a: "O Zetta é gratuito sob a licença MIT. Você paga pelo seu servidor e pelos provedores de modelo que seus agentes usam. Não existe plano hospedado.",
      },
      {
        q: "Está pronto para produção?",
        a: "Ainda é inicial. A definição do produto descreve a primeira versão pretendida, e algumas partes ainda estão em andamento. Leia o repositório e as issues antes de depender dele.",
      },
      {
        q: "Existe app desktop?",
        a: "O repositório tem um app desktop em apps/desktop. Esta página ainda não tem download dele.",
      },
    ],
  },
  cta: {
    title: "Rode seu primeiro chief.",
    lead: "Clone, suba e peça algo pequeno.",
    primary: "Hospedar o Zetta",
    secondary: "Ler a documentação",
  },
  footer: {
    tagline: "Bots que trabalham no seu servidor enquanto você faz outra coisa.",
    license: "Licença MIT",
    links: { repo: "Repositório", docs: "Docs", issues: "Issues" },
    columns: { product: "Produto", developers: "Desenvolvedores", language: "Idioma" },
  },
} satisfies Copy;
