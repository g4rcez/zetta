// Loaded into the e2e server only (`bun --preload`): the phone adapters call the providers' real addresses, and the server has no
// setting for another one (on purpose: nothing about phone is read from the environment). This points them at the fake Telnyx and the
// fake Twilio the run started, by rewriting the one constant each adapter keeps. Nothing in the repo's server code changes.
import { plugin } from "bun";

plugin({
  name: "phone-fakes",
  setup(build) {
    build.onLoad({ filter: /modules\/phone\/(telnyx|twilio)\.ts$/ }, async ({ path }) => {
      const telnyx = process.env.E2E_TELNYX_URL ?? "";
      const twilio = process.env.E2E_TWILIO_URL ?? "";
      const text = (await Bun.file(path).text())
        .replace('"https://api.telnyx.com/v2"', JSON.stringify(telnyx))
        .replace('"https://api.twilio.com/2010-04-01"', JSON.stringify(twilio));
      return { contents: text, loader: "ts" };
    });
  },
});
