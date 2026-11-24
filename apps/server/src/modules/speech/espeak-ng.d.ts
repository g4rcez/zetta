// The `espeak-ng` package (eSpeak NG compiled to WASM, voice data inside) ships no types. Only what `local.ts` uses is declared.
declare module "espeak-ng" {
  type Module = { FS: { readFile(path: string, opts: { encoding: "utf8" }): string } };
  /** Runs eSpeak NG's command line once; its output files are in the returned module's file system. */
  export default function ESpeakNg(opts: {
    arguments: string[];
    print?: (line: string) => void;
    printErr?: (line: string) => void;
  }): Promise<Module>;
}
