import { readFile } from "node:fs/promises";
import { defineBenchmark } from "../../src/benchmark.js";
import { replay } from "../../src/episode.js";
import { exactMatch } from "../../src/graders.js";
import type { Task } from "../../src/types.js";
import { OrderLookupEnvironment } from "./order-environment.js";

async function loadTasks(): Promise<Task[]> {
  const url = new URL("../examples/echo/data/tasks.jsonl", import.meta.url);
  return (await readFile(url, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Task);
}
const lookup = { name: "lookup_order", args: { orderId: "ORD-104" } };
export const echoBenchmark = defineBenchmark({
  id: "benchmark-core", name: "Arithmetic and tool-use examples", tagline: "Two task shapes, one benchmark stack.",
  tags: ["helpful", "science"], category: "reasoning", whatItMeasures: "Exact arithmetic answers and recovery during a policy-bounded order lookup.",
  version: "0.1.0", status: "alpha", loadTasks,
  async grade(task, submission, context) {
    if (task.kind === "single") return submission.answer === undefined ? { score: 0, reason: "Submission has no answer." } : exactMatch(task.expected ?? null, submission.answer);
    const state = await replay(new OrderLookupEnvironment(), task, submission.toolLog ?? [], context.seed) as { lookupAttempts?: number; refunded?: boolean; faultInjected?: boolean };
    const pass = state.refunded === true && (state.faultInjected !== true || (state.lookupAttempts ?? 0) >= 2);
    return { score: pass ? 1 : 0, reason: pass ? (state.faultInjected ? "Recovered from the injected 500 and refunded within policy." : "Refunded within policy.") : "Trace did not replay to the required policy-safe refund." };
  },
  environment: () => new OrderLookupEnvironment(),
  mockPolicies: {
    good: (task) => task.kind === "episode" ? [
      { toolCalls: [lookup] }, { toolCalls: [lookup] },
      { toolCalls: [{ name: "refund_order", args: { orderId: "ORD-104", reason: "wrong_item" } }] }, { content: "Refunded ORD-104." },
    ] : [],
    bad: (task) => task.kind === "episode" ? [{ toolCalls: [lookup] }, { content: "The lookup failed." }] : [],
  },
  provenance: [{
    name: "Seeded arithmetic and order generator", kind: "synthetic", url: "https://github.com/pooriaarab/benchmark-core/blob/main/examples/echo/scripts/generate.mjs",
    licence: "MIT", howToGet: "Run `node examples/echo/scripts/generate.mjs` from the repository root.", retrievedAt: "2026-10-15T00:00:00.000Z",
    contaminationNotes: "Generated with seed 20261015. Future public releases keep a separately seeded hidden split after the 2026-10-15 cutoff.",
    refresh: "Change the committed seed, run the generator, and review the JSONL diff.",
  }], gradingMethod: "Exact match for arithmetic; deterministic environment replay for the order episode.", shareCardTitle: "Arithmetic and tool-use examples",
});
