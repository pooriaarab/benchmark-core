import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
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
const retryCalls = new Map(); const retryAdapter = { id: "retry", async complete(_prompt, context) { const count = (retryCalls.get(context.task.id) ?? 0) + 1; retryCalls.set(context.task.id, count); if (count === 1) throw new Error("transient"); return { content: String(context.task.expected) }; }, chat: async () => ({ content: "", toolCalls: [] }) };
const retried = await core.run(echoBenchmark, retryAdapter, { retries: 1 }); assert.ok(retried.rows.every((row) => row.attempts === 2 && !row.error));
const ignoringAdapter = { id: "ignores-abort", complete: (_prompt, context) => new Promise((resolve) => setTimeout(() => resolve({ content: String(context.task.expected) }), 100)), chat: async () => ({ content: "", toolCalls: [] }) };
const timeoutStart = performance.now(); const timeoutReport = await core.run(echoBenchmark, ignoringAdapter, { timeoutMs: 5 });
assert.match(timeoutReport.rows[0].error, /timed out/); assert.ok(performance.now() - timeoutStart < 500);

const episodeTask = { id: "episode", kind: "episode", prompt: "Call ping once." };
class CounterEnvironment {
  constructor(doneAt = Number.POSITIVE_INFINITY) { this.doneAt = doneAt; this.count = 0; }
  reset() { this.count = 0; return { system: "Use ping.", tools: [{ name: "ping", description: "Increment.", parameters: { type: "object" } }] }; }
  callTool(_name, _args) { this.count++; return { result: { count: this.count } }; }
  state() { return { count: this.count }; } done() { return this.count >= this.doneAt; }
}
const policies = { good: () => [{ toolCalls: [{ name: "ping", args: {} }] }, { content: "done" }], bad: () => [{ content: "skipped" }] };
const episodeBenchmark = core.defineBenchmark({ id: "episode", name: "Episode", tagline: "Episode", tags: ["science"], category: "tools", whatItMeasures: "Tool use", version: "0.1.0", status: "alpha", tasks: [episodeTask], environment: () => new CounterEnvironment(), mockPolicies: policies, grade: (_task, trace) => ({ score: trace.toolLog?.length === 1 ? 1 : 0, reason: trace.toolLog?.length === 1 ? "Used tool." : "Skipped tool." }), provenance: [], gradingMethod: "tool count" });
const policyReports = await Promise.all([1, 2].map((seed) => core.run(episodeBenchmark, core.mockAdapter({ seed, policies }), { seed })));
assert.deepEqual(policyReports.map((value) => value.mean).sort(), [0, 1]);
assert.deepEqual(await core.replay(new CounterEnvironment(), episodeTask, [{ name: "ping", args: {}, result: null }]), { count: 1 });
const looping = { id: "loop", complete: async () => ({ content: "" }), chat: async () => ({ content: "", toolCalls: [{ id: "c1", name: "ping", args: {} }, { id: "c2", name: "ping", args: {} }] }) };
const maxTurns = await core.runEpisode(episodeTask, looping, new CounterEnvironment(), { maxTurns: 1, maxToolCalls: 5, budgetUsd: 1 }); assert.equal(maxTurns.aborted, "max_turns");
const maxTools = await core.runEpisode(episodeTask, looping, new CounterEnvironment(), { maxTurns: 2, maxToolCalls: 1, budgetUsd: 1 }); assert.equal(maxTools.aborted, "max_tool_calls"); assert.match(maxTools.transcript.at(-1).content, /episode_ended/);
const budgetAdapter = { ...looping, chat: async () => ({ content: "", toolCalls: [{ id: "budget", name: "ping", args: {} }], costUsd: 1 }) };
const budget = await core.runEpisode(episodeTask, budgetAdapter, new CounterEnvironment(), { maxTurns: 2, maxToolCalls: 2, budgetUsd: 0 }); assert.equal(budget.aborted, "budget"); assert.match(budget.transcript.at(-1).content, /episode_ended/);
const done = await core.runEpisode(episodeTask, looping, new CounterEnvironment(1), { maxTurns: 1, maxToolCalls: 5, budgetUsd: 1 }); assert.equal(done.aborted, undefined); assert.match(done.transcript.at(-1).content, /episode_ended/);
const emptyFinal = await core.runEpisode(episodeTask, { ...looping, chat: async () => ({ content: "", toolCalls: [] }) }, new CounterEnvironment(), { maxTurns: 1, maxToolCalls: 1, budgetUsd: 1 }); assert.equal(emptyFinal.finalAnswer, ""); assert.equal(emptyFinal.aborted, undefined);
let apiRequest; const fakeApi = createHttpServer(async (request, response) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); apiRequest = JSON.parse(Buffer.concat(chunks)); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: "parsed", function: { name: "ping", arguments: "{\"value\":7}" } }] } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.01 } })); });
await new Promise((resolve) => fakeApi.listen(0, "127.0.0.1", resolve)); const fakeAddress = fakeApi.address(); assert.ok(fakeAddress && typeof fakeAddress === "object");
const compat = core.openaiCompatAdapter({ baseUrl: `http://127.0.0.1:${fakeAddress.port}/v1`, model: "fake", apiKey: "test" }); const controller = new AbortController();
const parsed = await compat.chat({ messages: [{ role: "user", content: "ping" }], tools: [{ name: "ping", description: "Ping.", parameters: { type: "object" } }] }, { signal: controller.signal, attempt: 1, task: episodeTask, seed: 1, turn: 1 });
assert.deepEqual(parsed.toolCalls[0], { id: "parsed", name: "ping", args: { value: 7 } }); assert.equal(apiRequest.tools[0].function.name, "ping"); await new Promise((resolve) => fakeApi.close(resolve));

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
  const scoreResponse = await fetch(`${base}/v1/score`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, submission: { answer: listed.value.tasks[0].expected } }) });
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
    ["list_tasks", {}], ["get_task", { taskId: first.id }], ["score_answer", { taskId: first.id, submission: { answer: first.expected } }],
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
console.log(`e2e: ${artifact.task_count} tasks, episode policies/replay/3 aborts/chat parse, CLI serve ${Object.keys(routes).length} routes, MCP ${toolNames.length} tools -> all surfaces passed, ok`);
