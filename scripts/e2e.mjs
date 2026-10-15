import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DOMParser } from "@xmldom/xmldom";
const execFile = promisify(execFileCallback);
await execFile("npm", ["run", "build"], { cwd: process.cwd() });
const core = await import("../dist/index.js");
const { echoBenchmark } = await import("../dist/example.js");

const cli = await execFile(process.execPath, ["dist/cli.js", "run", "--model", "offline", "--provider", "mock", "--json"], { cwd: process.cwd(), maxBuffer: 2_000_000 });
const cliReport = JSON.parse(cli.stdout);
assert.equal(cliReport.rows.length, 20);
assert.ok(cliReport.mean > 0 && cliReport.mean < 1);
const ignoringAdapter = { id: "ignores-abort", generate: (task) => new Promise((resolve) => setTimeout(() => resolve({ answer: task.expected }), 100)) };
const timeoutStart = performance.now(); const timeoutReport = await core.run(echoBenchmark, ignoringAdapter, { timeoutMs: 5 });
assert.match(timeoutReport.rows[0].error, /timed out/); assert.ok(performance.now() - timeoutStart < 500);
let invalidPort; try { await execFile(process.execPath, ["dist/cli.js", "serve", "abc"], { cwd: process.cwd() }); } catch (error) { invalidPort = error; }
assert.equal(invalidPort?.code, 1); assert.match(invalidPort?.stderr, /serve port must be an integer/);
const probe = createNetServer(); await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve)); const address = probe.address(); assert.ok(address && typeof address === "object"); const port = address.port; await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ["dist/cli.js", "serve", String(port)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${port}`;
const routes = {};
const get = async (path) => { const response = await fetch(`${base}${path}`); routes[`GET ${path}`] = response.status; return { response, value: await response.json() }; };
try {
  let health; for (let attempt = 0; attempt < 100; attempt++) { try { health = await get("/health"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 20)); } }
  assert.ok(health);
  health = await get("/health"); assert.equal(health.response.status, 200); assert.equal(health.value.ok, true);
  const listed = await get("/v1/tasks"); assert.equal(listed.response.status, 200); assert.equal(listed.value.tasks.length, 20);
  const taskId = listed.value.tasks[0].id;
  const shown = await get(`/v1/tasks/${taskId}`); assert.equal(shown.response.status, 200); assert.equal(shown.value.task.id, taskId);
  const scoreResponse = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, answer: listed.value.tasks[0].expected }) });
  routes["POST /v1/score"] = scoreResponse.status; assert.equal(scoreResponse.status, 200); assert.equal((await scoreResponse.json()).score, 1);
  const provenance = await get("/v1/provenance"); assert.equal(provenance.response.status, 200); assert.equal(provenance.value.provenance.length, 1);
  const entry = await get("/v1/index-entry"); assert.equal(entry.response.status, 200); assert.equal(entry.value.task_count, 20);
} finally { if (server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); } }

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "benchmark-core-e2e", version: "0.1.0" });
await client.connect(transport);
let toolNames;
try {
  const available = await client.listTools(); toolNames = available.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_provenance", "get_task", "list_tasks", "run_benchmark", "score_answer"]);
  const first = (await echoBenchmark.listTasks())[0];
  const calls = [
    ["list_tasks", {}], ["get_task", { taskId: first.id }], ["score_answer", { taskId: first.id, answer: first.expected }],
    ["get_provenance", {}], ["run_benchmark", { model: "openai/gpt-4.1-mini" }],
  ];
  for (const [name, args] of calls) { const result = await client.callTool({ name, arguments: args }); if (name === "run_benchmark") assert.equal(result.isError, true); else assert.notEqual(result.isError, true); }
} finally { await client.close(); }

const svg = core.renderCard(cliReport);
const document = new DOMParser().parseFromString(svg, "image/svg+xml");
assert.equal(document.documentElement.nodeName, "svg"); assert.equal(document.getElementsByTagName("parsererror").length, 0);
const generatedProvenance = core.provenanceMarkdown(echoBenchmark);
assert.equal(generatedProvenance, await readFile("examples/echo/data/PROVENANCE.md", "utf8"));
const artifact = { task_count: cliReport.rows.length, scores: cliReport.rows.map((row) => row.score), route_status_codes: routes, tool_names: toolNames };
await mkdir("artifacts", { recursive: true }); await writeFile("artifacts/e2e-report.json", `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`e2e: ${artifact.task_count} tasks, timeout return, invalid port 1, CLI serve ${Object.keys(routes).length} routes, MCP ${toolNames.length} tools -> all surfaces passed, ok`);
