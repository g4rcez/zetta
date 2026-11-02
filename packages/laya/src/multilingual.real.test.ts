import { describe, expect, test } from "bun:test";
import { Laya } from "./laya";

// Opt-in: downloads the multilingual weights (about 1.3 GB) and needs about 2 GB of memory. ZETTA_LAYA_TEST=1 bun test packages/laya/src/multilingual.real.test.ts
const suite = process.env.ZETTA_LAYA_TEST === "1" ? describe : describe.skip;

const team = {
  type: "choice",
  instructions: "Which team should handle this message?",
  criteria: {
    billing: "payments, refunds, invoices",
    support: "product help and bugs",
    sales: "new purchases and pricing",
  },
} as const;
// The same request in five languages: a refund that never arrived.
const refund = {
  en: "I cancelled two weeks ago and I still have not received my refund.",
  pt: "Cancelei há duas semanas e ainda não recebi meu reembolso.",
  es: "Cancelé hace dos semanas y todavía no he recibido mi reembolso.",
  ja: "2週間前にキャンセルしましたが、まだ返金されていません。",
  zh: "我两周前取消了订单，但仍然没有收到退款。",
};
const bug = {
  en: "The app crashes every time I open the settings page.",
  pt: "O aplicativo trava toda vez que abro a página de configurações.",
  ja: "設定ページを開くたびにアプリがクラッシュします。",
};

suite("multilingual checkpoint (real model)", () => {
  test("the same request in five languages gets the same team (measured: 4 of 5 refunds, 3 of 3 bugs)", async () => {
    const laya = await Laya.load({ variant: "multilingual" });
    try {
      const rows: string[] = [];
      let refunds = 0;
      let bugs = 0;
      for (const [lang, text] of Object.entries(refund)) {
        const a = (await laya.systemOne(text, { team })).answers.team;
        rows.push(`refund ${lang}: ${a.choice} ${a.answer_confidence}`);
        refunds += a.choice === "billing" ? 1 : 0;
      }
      for (const [lang, text] of Object.entries(bug)) {
        const a = (await laya.systemOne(text, { team })).answers.team;
        rows.push(`bug ${lang}: ${a.choice} ${a.answer_confidence}`);
        bugs += a.choice === "support" ? 1 : 0;
      }
      console.log(rows.join("\n"));
      // Japanese is the weak one: it picks "support" for the refund, with low confidence (about 0.57).
      expect(refunds).toBeGreaterThanOrEqual(4);
      expect(bugs).toBe(3);
    } finally {
      await laya.close();
    }
  }, 600_000);

  // config.json lists cls_token_id 1, the tokenizer says <bos> (id 2). Report both; the default (tokenizer) must be the sound one.
  test("cls id: tokenizer <bos> against config.json id", async () => {
    const byTokenizer = await Laya.load({ variant: "multilingual" });
    const byConfig = await Laya.load({ variant: "multilingual", ids: { cls: 1 } });
    try {
      const rows: string[] = [];
      let tokenizerRight = 0;
      let configRight = 0;
      for (const [text, want] of [
        ...Object.values(refund).map((t) => [t, "billing"] as const),
        ...Object.values(bug).map((t) => [t, "support"] as const),
      ]) {
        const a = (await byTokenizer.systemOne(text, { team })).answers.team;
        const b = (await byConfig.systemOne(text, { team })).answers.team;
        tokenizerRight += a.choice === want ? 1 : 0;
        configRight += b.choice === want ? 1 : 0;
        rows.push(
          `${want}: tokenizer ${a.choice} ${a.answer_confidence} | config ${b.choice} ${b.answer_confidence}`,
        );
      }
      console.log(
        `${rows.join("\n")}\ntokenizer right ${tokenizerRight}/8, config right ${configRight}/8`,
      );
      expect(tokenizerRight).toBeGreaterThanOrEqual(configRight);
      expect(tokenizerRight).toBeGreaterThanOrEqual(7);
    } finally {
      await byTokenizer.close();
      await byConfig.close();
    }
  }, 600_000);

  test("attention rubric on English prompts, multilingual against English model", async () => {
    const attention = {
      type: "score" as const,
      instructions: "How much work does this message ask an assistant to do?",
      criteria: [
        "a greeting, thanks, or a short acknowledgement",
        "a simple question or one small action",
        "a task with several steps or several sources",
        "a long, complex or high-stakes task that needs a plan and checks",
      ],
    };
    const prompts = [
      "thanks!",
      "ok, got it",
      "what time is it in Tokyo?",
      "add a reminder for tomorrow at 9",
      "summarize this email",
      "compare three vendors and write a recommendation with sources",
      "rebuild the billing reports for every client and verify the totals",
    ];
    const multi = await Laya.load({ variant: "multilingual" });
    const english = await Laya.load({ variant: "english" });
    try {
      const rows: string[] = [];
      for (const p of prompts) {
        const m = (await multi.systemOne(p, { attention })).answers.attention;
        const e = (await english.systemOne(p, { attention })).answers.attention;
        rows.push(
          `${p.padEnd(70)} multi ${m.score} (${m.answer_confidence}) | english ${e.score} (${e.answer_confidence})`,
        );
      }
      console.log(rows.join("\n"));
      const [thanks, ...rest] = await Promise.all([
        multi.systemOne("thanks!", { attention }),
        multi.systemOne("rebuild the billing reports for every client and verify the totals", {
          attention,
        }),
      ]).then((r) => r.map((x) => x.answers.attention.score));
      expect(thanks).toBeLessThan(rest[0]!);
    } finally {
      await multi.close();
      await english.close();
    }
  }, 900_000);
});
