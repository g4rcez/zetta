// A connection that only prints what would be sent.
import type { Remote } from "./ssh";

export function createDryRemote(user: string, say: (line: string) => void): Remote {
  return {
    user,
    probe: async () => true,
    async run(step, as = "self") {
      say(`# ssh ${user} (${as === "root" ? "with sudo" : "no sudo"}), step ${step.id}`);
      say(step.script);
      return 0;
    },
    async capture(command) {
      say(`# ssh ${user}: ${command}`);
      return "";
    },
    async interactive(command) {
      say(`# ssh -t ${user}: ${command ?? "(shell)"}`);
      return 0;
    },
    async upload(folder, destination, filters) {
      say(`# rsync ${filters.join(" ")} ${folder}/ -> ${destination}/`);
    },
    async download(command, file) {
      say(`# ssh ${user}: ${command} > ${file}`);
    },
    close: async () => {},
  };
}
