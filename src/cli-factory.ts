import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { mockAdapter, openaiCompatAdapter, openrouterAdapter } from "./adapters.js";
import { createHandler, serve } from "./api.js";
import { indexEntry, provenanceMarkdown } from "./metadata.js";
import { startMcp } from "./mcp.js";
import { renderCard, renderMarkdown } from "./render.js";
import { bootstrapCI } from "./random.js";
import { run } from "./run.js";
import type { Answer, Benchmark, ModelAdapter, RunReport, RunRow } from "./types.js";

class UsageError extends Error {}
const usage = (bin: string) => `Usage: ${bin} <list|show|run|score|card|provenance|index-entry|serve|mcp> [options]`;
function report(value: unknown): RunReport {
  if (value === null || typeof value !== "object" || Array.isArray(value) || !Array.isArray(Reflect.get(value, "rows"))) throw new UsageError("File is not a run report.");
  return value as RunReport;
}
function adapter(provider: string, model: string): ModelAdapter {
  if (provider === "mock") return mockAdapter();
  if (provider === "openrouter") return openrouterAdapter({ model });
  if (provider === "openai") return openaiCompatAdapter({ model });
  throw new UsageError("--provider must be openrouter, openai, or mock.");
}
export function createCli(benchmark: Benchmark, options: { bin: string }) {
  return { async main(argv: string[]): Promise<number> {
    const command = argv[0]; const rest = argv.slice(1); const jsonOutput = rest.includes("--json");
    const clean = rest.filter((arg) => arg !== "--json");
    try {
      if (!command || command === "help" || command === "--help") { console.error(usage(options.bin)); return command ? 0 : 1; }
      if (command === "list") {
        const tasks = await benchmark.listTasks(); console.log(jsonOutput ? JSON.stringify({ tasks }) : tasks.map((task) => `${task.id}\t${task.prompt}`).join("\n")); return 0;
      }
      if (command === "show") {
        const id = clean[0]; if (!id) throw new UsageError("show needs a task id."); const task = await benchmark.getTask(id); if (!task) throw new UsageError(`Task not found: ${id}`);
        console.log(jsonOutput ? JSON.stringify({ task }) : `${task.id}\n\n${task.prompt}`); return 0;
      }
      if (command === "run") {
        const parsed = parseArgs({ args: clean, options: { model: { type: "string" }, provider: { type: "string" }, concurrency: { type: "string" }, timeout: { type: "string" }, retries: { type: "string" }, seed: { type: "string" } }, strict: true });
        const model = parsed.values.model; const provider = parsed.values.provider; if (!model || !provider) throw new UsageError("run needs --model and --provider.");
        const result = await run(benchmark, adapter(provider, model), { ...(parsed.values.concurrency ? { concurrency: Number(parsed.values.concurrency) } : {}), ...(parsed.values.timeout ? { timeoutMs: Number(parsed.values.timeout) } : {}), ...(parsed.values.retries ? { retries: Number(parsed.values.retries) } : {}), ...(parsed.values.seed ? { seed: Number(parsed.values.seed) } : {}) });
        console.log(jsonOutput ? JSON.stringify(result) : renderMarkdown(result)); return result.rows.some((row) => row.error) ? 2 : 0;
      }
      if (command === "score") {
        const file = clean[0]; if (!file) throw new UsageError("score needs a results JSON file."); const original = report(JSON.parse(await readFile(file, "utf8")) as unknown); const rows: RunRow[] = [];
        for (const row of original.rows) { const task = await benchmark.getTask(row.taskId); if (!task || row.answer === undefined) throw new UsageError(`Cannot score task ${row.taskId}.`); const grade = await benchmark.score(task, row.answer as Answer); rows.push({ ...row, score: grade.score, reason: grade.reason }); }
        const scores = rows.map((row) => row.score); const rescored = { ...original, rows, mean: scores.reduce((a, b) => a + b, 0) / scores.length, confidenceInterval95: bootstrapCI(scores, original.seed) };
        console.log(jsonOutput ? JSON.stringify(rescored) : renderMarkdown(rescored)); return 0;
      }
      if (command === "card") {
        const file = clean[0]; if (!file) throw new UsageError("card needs a report JSON file."); const svg = renderCard(report(JSON.parse(await readFile(file, "utf8")) as unknown)); const output = clean[1];
        if (output) { await writeFile(output, svg); console.log(jsonOutput ? JSON.stringify({ output }) : output); } else console.log(jsonOutput ? JSON.stringify({ svg }) : svg); return 0;
      }
      if (command === "provenance") { const value = provenanceMarkdown(benchmark); console.log(jsonOutput ? JSON.stringify({ provenance: benchmark.definition.provenance }) : value); return 0; }
      if (command === "index-entry") { console.log(JSON.stringify(await indexEntry(benchmark), null, jsonOutput ? 0 : 2)); return 0; }
      if (command === "serve") {
        const parsed = parseArgs({ args: clean, options: { host: { type: "string" } }, allowPositionals: true, strict: true });
        if (parsed.positionals.length > 1) throw new UsageError("serve accepts at most one port.");
        const port = Number(parsed.positionals[0] ?? process.env.PORT ?? 3000); const hostname = parsed.values.host ?? "127.0.0.1";
        await serve(createHandler(benchmark), { port, hostname }); console.log(jsonOutput ? JSON.stringify({ listening: port, host: hostname }) : `Listening on http://${hostname}:${port}`); return 0;
      }
      if (command === "mcp") { await startMcp(benchmark); return 0; }
      throw new UsageError(`Unknown command: ${command}`);
    } catch (caught) { console.error(caught instanceof Error ? caught.message : String(caught)); if (caught instanceof UsageError) console.error(usage(options.bin)); return caught instanceof UsageError ? 1 : 2; }
  } };
}
