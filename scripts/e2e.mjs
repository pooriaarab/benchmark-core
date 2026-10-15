import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
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
assert.equal(cliReport.rows.length, 21);
assert.ok(cliReport.mean > 0 && cliReport.mean < 1);
const episodeTask = (await echoBenchmark.listTasks()).find((task) => task.kind === "episode");
const paidAdapter = { id: "paid-mock", complete: async () => ({ content: "wrong" }), chat: async () => ({ content: "", toolCalls: [], costUsd: 0.01 }) };
const budgetEpisode = await core.runEpisode(episodeTask, paidAdapter, echoBenchmark.definition.environment(episodeTask), { maxTurns: 2, maxToolCalls: 2, budgetUsd: 0 });
assert.equal(budgetEpisode.aborted, "budget");
const budgetReport = await core.run(echoBenchmark, paidAdapter, { budgetUsd: 0 });
const budgetRow = budgetReport.rows.find((row) => row.kind === "episode"); assert.equal(budgetRow.episode.aborted, "budget"); assert.equal(budgetRow.score, 0); assert.equal(budgetRow.error, undefined);
const episodeRow = cliReport.rows.find((row) => row.kind === "episode");
assert.equal(episodeRow.score, 1); assert.equal(episodeRow.episode.toolLog[0].error.code, "HTTP_500"); assert.equal(episodeRow.submission.finalState.refunded, true);

const handler = core.createHandler(echoBenchmark);
const server = await core.serve(handler, { port: 0, hostname: "127.0.0.1" });
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;
const routes = {};
const get = async (path) => { const response = await fetch(`${base}${path}`); routes[`GET ${path}`] = response.status; return { response, value: await response.json() }; };
try {
  const health = await get("/health"); assert.equal(health.response.status, 200); assert.equal(health.value.ok, true);
  const listed = await get("/v1/tasks"); assert.equal(listed.response.status, 200); assert.equal(listed.value.tasks.length, 21);
  const taskId = "order-lookup-01";
  const shown = await get(`/v1/tasks/${taskId}`); assert.equal(shown.response.status, 200); assert.equal(shown.value.task.id, taskId);
  const scoreResponse = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, submission: episodeRow.submission }) });
  routes["POST /v1/score"] = scoreResponse.status; assert.equal(scoreResponse.status, 200); assert.equal((await scoreResponse.json()).score, 1);
  const provenance = await get("/v1/provenance"); assert.equal(provenance.response.status, 200); assert.equal(provenance.value.provenance.length, 1);
  const entry = await get("/v1/index-entry"); assert.equal(entry.response.status, 200); assert.equal(entry.value.task_count, 21);
} finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }

const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "mcp"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "benchmark-core-e2e", version: "0.1.0" });
await client.connect(transport);
let toolNames;
try {
  const available = await client.listTools(); toolNames = available.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_provenance", "get_task", "list_tasks", "run_benchmark", "score_answer"]);
  const calls = [
    ["list_tasks", {}], ["get_task", { taskId: "order-lookup-01" }], ["score_answer", { taskId: "order-lookup-01", submission: episodeRow.submission }],
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
console.log(`e2e: ${artifact.task_count} tasks, ${Object.keys(routes).length} routes, ${toolNames.length} MCP tools`);
