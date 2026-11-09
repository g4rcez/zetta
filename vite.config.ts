import { defineConfig } from "vite-plus";
import oxfmt from "./oxfmt.config";
import oxlint from "./oxlint.config";

export default defineConfig({
  lint: { ...oxlint, options: { typeAware: false, typeCheck: false } },
  fmt: oxfmt,
  staged: {
    "*.{js,ts,jsx,tsx,vue,svelte,json,jsonc,css,md}": "vp check --fix",
  },
});
