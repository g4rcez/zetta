import { SpeechSettings } from "./speech-settings";
import { TranscribeSettings } from "./transcribe-settings";

/** Voice for the whole installation: what turns speech into text, and text into speech. Each card shows a member one sentence. */
export function Voice() {
  return (
    <section aria-label="Voice" className="grid items-start gap-4">
      <div className="rounded-xl border bg-card p-5">
        <TranscribeSettings />
      </div>
      <div className="rounded-xl border bg-card p-5">
        <SpeechSettings />
      </div>
    </section>
  );
}
