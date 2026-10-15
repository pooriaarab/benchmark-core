import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defineBenchmark, exactMatch, jsonSchemaMatch, mockAdapter, numericWithin, regexMatch, run } from "../dist/index.js";
const tasks = Array.from({ length: 4 }, (_, index) => ({ id: String(index), prompt: `Return ${index}`, expected: String(index) }));
const benchmark = defineBenchmark({ id: "smoke", name: "Smoke", tagline: "Smoke", tags: ["science"], category: "test", whatItMeasures: "Core execution", version: "0.1.0", status: "alpha", tasks, grade: (task, answer) => exactMatch(task.expected, answer), provenance: [], gradingMethod: "exact match" });
const report = await run(benchmark, mockAdapter({ seed: 1 }), { concurrency: 2 });
assert.equal(report.rows.length, 4); assert.ok(report.mean > 0 && report.mean < 1);
const calls = new Map(); const retryAdapter = { id: "retry", async generate(task) { const count = (calls.get(task.id) ?? 0) + 1; calls.set(task.id, count); if (count === 1) throw new Error("transient"); return { answer: task.expected }; } };
const retried = await run(benchmark, retryAdapter, { retries: 1 }); assert.ok(retried.rows.every((row) => row.attempts === 2 && !row.error));
assert.equal(regexMatch(/^ok$/, "ok").score, 1); assert.equal(numericWithin(10, 0.1, 10.05).score, 1); assert.equal(jsonSchemaMatch({ type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } }, { ok: true }).score, 1);
const probe = createServer(); await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); const address = probe.address(); assert.ok(address && typeof address === "object"); const port = address.port; await new Promise((resolve) => probe.close(resolve));
const child = spawn(process.execPath, ["scripts/e2e-cli.mjs", "serve", String(port)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
try {
  let health; for (let attempt = 0; attempt < 50; attempt++) { try { health = await fetch(`http://127.0.0.1:${port}/health`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  assert.equal(health?.status, 200);
  const scored = await fetch(`http://127.0.0.1:${port}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: "0", answer: "0" }) });
  assert.equal(scored.status, 200); assert.equal((await scored.json()).score, 1);
} finally { child.kill("SIGTERM"); await new Promise((resolve) => child.once("exit", resolve)); }
const transport = new StdioClientTransport({ command: process.execPath, args: ["scripts/e2e-cli.mjs", "mcp"], cwd: process.cwd(), stderr: "pipe" }); const client = new Client({ name: "core-e2e", version: "0.1.0" }); await client.connect(transport);
const listed = await client.listTools(); assert.equal(listed.tools.length, 5); const mcpScore = await client.callTool({ name: "score_answer", arguments: { taskId: "0", answer: "0" } }); assert.notEqual(mcpScore.isError, true); await client.close();
console.log(`e2e: CLI serve POST /v1/score 200; MCP ${listed.tools.length} tools -> surfaces exercised, ok`);
