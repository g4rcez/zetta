/**
 * The fixed sentences of a phone call, in the three languages the product speaks, and the matcher for "do not call me again". The words
 * are not the bot's to change: the greeting in particular says that an automated assistant answers, and nothing can switch it off.
 */
export type PhoneLanguage = "en" | "pt" | "es";

/** The language of a tag ("pt-BR", "es", "en-US"); English for anything else. */
export const phoneLanguageOf = (tag?: string | null): PhoneLanguage => {
  const head = (tag ?? "").trim().toLowerCase().slice(0, 2);
  return head === "pt" || head === "es" ? head : "en";
};

type Words = {
  /** The opening sentence of every call. */
  greeting: (owner: string) => string;
  /** The opening sentence of a call the bot places: fixed, said first on every outgoing call, and nothing can switch it off. */
  outGreeting: (owner: string) => string;
  /** The callee asked not to be called again. */
  optoutBye: string;
  notInService: string;
  busy: string;
  ownerOnly: string;
  limit: string;
  help: string;
  askPin: string;
  pinOk: string;
  pinWrong: string;
  pinLocked: string;
  pinSkipped: string;
  timeUp: string;
  goodbye: string;
  unavailable: string;
};

export const WORDS: Record<PhoneLanguage, Words> = {
  en: {
    greeting: (owner) => `Hello, this is ${owner}'s automated assistant.`,
    outGreeting: (owner) => `Hello, I'm an automated assistant calling on behalf of ${owner}.`,
    optoutBye: "Understood. This number will not be called again. Goodbye.",
    notInService: "This number is not in service. Goodbye.",
    busy: "This assistant is on another call. Please try again later. Goodbye.",
    ownerOnly: "This number only takes calls from its owner. Goodbye.",
    limit: "This assistant cannot take more calls right now. Please try again later. Goodbye.",
    help: "I can take a message or answer a question. How can I help you?",
    askPin: "Please enter your code on the keypad, then press the pound key.",
    pinOk: "Thank you. How can I help?",
    pinWrong: "That code was not right. Please try again.",
    pinLocked: "That code is locked for now. Goodbye.",
    pinSkipped: "I will continue as for any caller. How can I help you?",
    timeUp: "The time for this call is over. Goodbye.",
    goodbye: "Goodbye.",
    unavailable: "I cannot help right now. Please try again later. Goodbye.",
  },
  pt: {
    greeting: (owner) => `Olá, aqui é o assistente automático de ${owner}.`,
    outGreeting: (owner) => `Olá, sou um assistente automático ligando em nome de ${owner}.`,
    optoutBye: "Entendido. Este número não receberá mais ligações. Até logo.",
    notInService: "Este número está fora de serviço. Até logo.",
    busy: "Este assistente está em outra ligação. Tente novamente mais tarde. Até logo.",
    ownerOnly: "Este número só recebe ligações do seu dono. Até logo.",
    limit:
      "Este assistente não pode atender mais ligações agora. Tente novamente mais tarde. Até logo.",
    help: "Posso anotar um recado ou responder a uma pergunta. Como posso ajudar?",
    askPin: "Digite o seu código no teclado e depois a tecla jogo da velha.",
    pinOk: "Obrigado. Como posso ajudar?",
    pinWrong: "O código não está certo. Tente de novo.",
    pinLocked: "Esse código está bloqueado por enquanto. Até logo.",
    pinSkipped: "Vou seguir como com qualquer pessoa. Como posso ajudar?",
    timeUp: "O tempo desta ligação acabou. Até logo.",
    goodbye: "Até logo.",
    unavailable: "Não consigo ajudar agora. Tente novamente mais tarde. Até logo.",
  },
  es: {
    greeting: (owner) => `Hola, soy el asistente automático de ${owner}.`,
    outGreeting: (owner) => `Hola, soy un asistente automático que llama en nombre de ${owner}.`,
    optoutBye: "Entendido. No se volverá a llamar a este número. Adiós.",
    notInService: "Este número está fuera de servicio. Adiós.",
    busy: "Este asistente está en otra llamada. Inténtelo de nuevo más tarde. Adiós.",
    ownerOnly: "Este número solo recibe llamadas de su dueño. Adiós.",
    limit: "Este asistente no puede atender más llamadas ahora. Inténtelo más tarde. Adiós.",
    help: "Puedo dejar un mensaje o responder una pregunta. ¿En qué puedo ayudar?",
    askPin: "Marque su código en el teclado y luego la tecla numeral.",
    pinOk: "Gracias. ¿En qué puedo ayudar?",
    pinWrong: "Ese código no es correcto. Inténtelo de nuevo.",
    pinLocked: "Ese código está bloqueado por ahora. Adiós.",
    pinSkipped: "Seguiré como con cualquier persona. ¿En qué puedo ayudar?",
    timeUp: "El tiempo de esta llamada terminó. Adiós.",
    goodbye: "Adiós.",
    unavailable: "No puedo ayudar ahora. Inténtelo más tarde. Adiós.",
  },
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const NOT_AGAIN: readonly RegExp[] = [
  // English: "don't call me", "do not call me again", "stop calling", "never call", "take me off your list"
  /\b(?:do not|don'?t|dont|never|stop|quit|no more)\s+(?:call|calling|phone|phoning|ring|ringing)\b/,
  /\b(?:remove|take)\s+(?:me|this number)\s+(?:off|from)\s+(?:your|the)\s+(?:call(?:ing)?\s+)?list\b/,
  // Portuguese: "não me ligue", "não me liga mais", "pare de me ligar", "não quero mais ligações"
  /\bnao\s+(?:me\s+)?(?:ligue|liga|telefone|ligar)\b/,
  /\bpare\s+de\s+(?:me\s+)?(?:ligar|telefonar)\b/,
  /\bnao\s+quero\s+(?:mais\s+)?(?:que\s+(?:me\s+)?(?:ligue|liguem|telefone)|ligacoes|chamadas)\b/,
  // Spanish: "no me llames", "no me llame más", "deja de llamarme", "no me vuelvas a llamar"
  /\bno\s+(?:me\s+)?(?:llames|llame|llamen|llamar|telefonees)\b/,
  /\bno\s+me\s+vuelv\w+\s+a\s+llamar\b/,
  /\bdej\w+\s+de\s+llamar(?:me|nos)?\b/,
  /\bno\s+quiero\s+(?:mas\s+)?(?:que\s+(?:me\s+)?llam\w+|llamadas)\b/,
];

/**
 * Whether what a caller said asks not to be called again ("don't call me", "não me ligue", "no me llames"). A small matcher on purpose:
 * it errs towards adding the number to the do-not-call list, which only stops the bots calling that number.
 */
export const asksNotToBeCalled = (said: string): boolean => {
  const t = fold(said);
  return t.length > 0 && NOT_AGAIN.some((re) => re.test(t));
};
