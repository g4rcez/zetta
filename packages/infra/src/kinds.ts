// Every kind of infra this package can install. A new kind is a folder beside `vps/` and one line here.
import { vps } from "./vps";

export const KINDS = { vps };
export type KindId = keyof typeof KINDS;
