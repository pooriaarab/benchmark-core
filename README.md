# benchmark-core

[![npm](https://img.shields.io/npm/v/benchmark-core)](https://www.npmjs.com/package/benchmark-core) [![downloads](https://img.shields.io/npm/dm/benchmark-core)](https://www.npmjs.com/package/benchmark-core) [![license](https://img.shields.io/npm/l/benchmark-core)](./LICENSE) [![types](https://img.shields.io/badge/TypeScript-types-3178c6)](#api)

[AI Benchmark Index](https://private-repo-337e.com) · [npm](https://www.npmjs.com/package/benchmark-core) · [API](#api) · [MCP](#model-context-protocol)

benchmark-core is an open-source TypeScript engine for reproducible AI model benchmarks. One definition produces an SDK, command-line interface (CLI), Model Context Protocol (MCP) server, and HTTP API.

It measures whatever your tasks and deterministic grader define. The included example measures 20 arithmetic answers and one tool-use episode with a transient order-service fault.

```bash
npx benchmark-core run --model offline --provider mock --json
```

```json
{"model":"mock:1","mean":0.5238,"confidenceInterval95":{"low":0.3333,"high":0.7143},"totals":{"tasks":21,"passed":11,"failed":0}}
```

The example data comes from a [committed seeded generator](https://github.com/pooriaarab/benchmark-core/blob/main/examples/echo/scripts/generate.mjs). Seed `20261015` reproduces every public task.

## Install

benchmark-core requires Node.js 20 or newer.

```bash
npm install benchmark-core
```

The package has one runtime dependency: the official MCP TypeScript SDK.

## Define a benchmark

```ts
import { defineBenchmark, exactMatch, run, mockAdapter } from "benchmark-core";

const benchmark = defineBenchmark({
  id: "benchmark-colors",
  name: "Color recall",
  tagline: "Checks exact color recall.",
  tags: ["science"],
  category: "memory",
  whatItMeasures: "Exact recall of a named color.",
  version: "0.1.0",
  status: "alpha",
  tasks: [{ id: "sky", kind: "single", prompt: "Name the sky color.", expected: "blue" }],
  grade: (task, submission) => exactMatch(task.expected, submission.answer ?? ""),
  provenance: [{
    name: "Maintainer-written task",
    kind: "human-written",
    url: "https://github.com/example/benchmark-colors",
    licence: "MIT",
    howToGet: "Read data/tasks.jsonl.",
    retrievedAt: "2026-10-15T00:00:00.000Z",
    contaminationNotes: "Public task; use a hidden split for final comparisons.",
    refresh: "Review and add tasks through pull requests."
  }],
  gradingMethod: "Exact string match."
});

const report = await run(benchmark, mockAdapter(), { concurrency: 2, seed: 7 });
console.log(report.mean);
```

`tasks` can be replaced by an asynchronous `loadTasks()` function. Task IDs must be unique, and each task declares `kind: "single" | "episode"`.

## How it works

```text
defineBenchmark({ tasks, grade, environment, provenance })
                  │
        ┌─────────┼──────────┐
        │         │          │
       SDK       CLI      MCP server
        │         │          │
        └─────────┴──── HTTP handler
                  │
             RunReport JSON
```

The runner preserves task order while it uses bounded concurrency. Each row records attempts, latency, score, reason, usage, and errors. Episode rows also contain the transcript, tool log, final state, and abort reason.

The 95% confidence interval uses 2,000 seeded bootstrap resamples. Identical scores and seeds produce identical intervals.

## Runtime surfaces

### CLI

A benchmark package calls `createCli(benchmark, { bin })`. The returned `main(argv)` supports:

- `list`
- `show <task>`
- `run --model <id> --provider <openrouter|openai|mock>` with optional episode limits
- `score <results.json>`
- `card <report.json> [output.svg]`
- `provenance`
- `index-entry`
- `serve [port]`
- `mcp`

Every command accepts `--json`. Exit code 0 means success, 1 means invalid usage, and 2 means a run or runtime failure.

### Model Context Protocol

`createMcpServer(benchmark)` exposes `list_tasks`, `get_task`, `score_answer`, `run_benchmark`, and `get_provenance`. `startMcp(benchmark)` connects it to standard input and output.

`run_benchmark` uses OpenRouter and requires `OPENROUTER_API_KEY`. The other four tools need no network or key.

### HTTP API

`createHandler(benchmark)` returns `(request: Request) => Promise<Response>`. It has no global state and works with Node.js or Cloudflare Workers.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/health` | Package identity and health |
| GET | `/v1/tasks` | All tasks |
| GET | `/v1/tasks/:id` | One task |
| POST | `/v1/score` | Deterministic score for `{ taskId, submission }` |
| GET | `/v1/provenance` | Data sources |
| GET | `/v1/index-entry` | Directory entry |

GET responses include permissive Cross-Origin Resource Sharing (CORS). Request bodies over 1 MiB return a stable `REQUEST_TOO_LARGE` error.

`serve(handler, { port })` hosts the same handler with `node:http`.

The server listens on `127.0.0.1` by default. Use `serve --host 0.0.0.0` only when a container or proxy needs an external bind.

`POST /v1/score` has no built-in authentication. Put authorization and rate limits in front of public deployments. An opt-in LLM-judged grader makes a paid model call for every score request.


## Tool-use episodes

An episode task runs against a seeded, in-process `Environment`. The environment exposes JSON-schema tool definitions and four deterministic methods:

```ts
interface Environment {
  reset(task, seed): { system: string; tools: ToolSpec[] };
  callTool(name, args): { result: unknown; error?: { code: string; message: string } };
  state(): unknown;
  done(): boolean;
}
```

`runEpisode(task, adapter, environment, options)` enforces turn, tool-call, and dollar limits. A budget breach returns an episode with `aborted: "budget"`; the main runner still sends its trace to the grader.

The universal submission is a `Trace`:

```ts
{
  answer?: string;
  toolLog?: ToolLogEntry[];
  finalState?: unknown;
}
```

`replay(environment, task, toolLog, seed)` resets the simulator and repeats only recorded calls. Episode graders can compute a result without a model or network call.

The reference `OrderLookupEnvironment` injects an HTTP 500 on its first seeded lookup. Its good mock policy retries, loads a $35 order, and applies the $50 refund limit.

## Model adapters

- `mockAdapter({ seed, policies })` works offline. It returns a deterministic mix of expected and wrong answers, then follows benchmark-supplied `good(task)` or `bad(task)` episode scripts.
- `openrouterAdapter({ model })` reads `OPENROUTER_API_KEY`.
- `openaiCompatAdapter({ baseUrl, model })` reads `OPENAI_BASE_URL` and `OPENAI_API_KEY` when options omit them.

Adapters implement `complete(prompt, context)` for single tasks and `chat({ messages, tools }, context)` for episodes. API-reported usage and cost flow into each row and report total.

## Graders

- `exactMatch(expected, answer)` compares JSON values exactly.
- `regexMatch(pattern, answer)` tests string answers.
- `numericWithin(expected, tolerance, answer)` accepts numbers within an inclusive tolerance.
- `jsonSchemaMatch(schema, answer)` checks a dependency-free JSON Schema subset.
- `judgeWithLLM(adapter, prompt?)` creates an opt-in model grader.

`jsonSchemaMatch` supports `type`, `enum`, `required`, `properties`, `items`, `additionalProperties`, `pattern`, `minimum`, and `maximum`.

The default judge prompt is exported as `DEFAULT_JUDGE_PROMPT`:

> Score the candidate answer from 0 to 1. Return only JSON with numeric score and string reason.

A judge must return `{"score": number, "reason": string}`. Model judging is off unless benchmark code calls `judgeWithLLM`.

## Reports and metadata

- `renderCard(report)` returns a 1200×630 SVG share card.
- `renderMarkdown(report)` returns a Markdown summary and task table.
- `indexEntry(benchmark)` returns the AI Benchmark Index record.
- `provenanceMarkdown(benchmark)` renders provenance documentation from code.

Commit the rendered provenance file beside `tasks.jsonl`. The end-to-end test compares the example file byte for byte.

## Utilities and types

`mulberry32(seed)` provides the small seeded random number generator. `bootstrapCI(values, seed?, resamples?)` returns percentile bounds.

The package exports these types:

- `Task`, `Trace`, `TaskScore`, and `GradeContext`
- `ToolSpec`, `ToolCall`, `ToolLogEntry`, `ToolResult`, and `ToolError`
- `Environment`, `EnvironmentStart`, `Episode`, and `EpisodeOptions`
- `BenchmarkDefinition`, `Benchmark`, `BenchmarkTag`, and `BenchmarkStatus`
- `ModelAdapter`, `ModelAdapterContext`, `CompletionResult`, `ChatRequest`, `ChatResult`, `ChatMessage`, and `ModelUsage`
- `MockPolicies` and `ScriptedTurn`
- `RunOptions`, `RunRow`, and `RunReport`
- `Provenance`, `ProvenanceKind`, and `IndexEntry`
- `JsonSchema`, `JsonSchemaObject`, `JsonValue`, `JsonPrimitive`, and `Answer`

## Limits

The runner does not hide failed tasks. Exhausted retries become zero-score rows with an error message.

A timeout stops waiting and aborts the provider signal. Provider work can continue in the background if its adapter ignores that signal.

The built-in schema grader implements the documented subset, not the full JSON Schema specification. Cost stays absent when a provider omits it.

The public arithmetic and order tasks test the surfaces, not frontier model ability. Use a private or held-out split for serious comparisons.

## Development

```bash
npm ci
npm run ci:local
```

The gate lints, type-checks, builds, and runs one end-to-end script. That script exercises every task, API route, and MCP tool, then writes `artifacts/e2e-report.json`.

Version 0.1.0 is alpha. Report defects through [GitHub issues](https://github.com/pooriaarab/benchmark-core/issues).

## License

[MIT](./LICENSE) © Pooria Arab
