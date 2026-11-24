import type { Clock } from "./core/types";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

/** A clock the test moves by hand. */
export class FakeClock implements Clock {
  t = 0;
  private id = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.t;
  setTimeout(fn: () => void, ms: number) {
    this.timers.set(++this.id, { at: this.t + ms, fn });
    return this.id;
  }
  clearTimeout(h: unknown) {
    this.timers.delete(h as number);
  }
  get pending() {
    return this.timers.size;
  }
  async advance(ms: number) {
    const target = this.t + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .find(([, v]) => v.at <= target);
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
      await settle();
    }
    this.t = target;
    await settle();
  }
}
