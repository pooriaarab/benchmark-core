import { defineConfig } from "tsup";
export default defineConfig({ entry: { index: "src/index.ts", cli: "src/cli.ts", example: "examples/echo/benchmark.ts" }, format: ["esm"], dts: true, clean: true, sourcemap: true });
