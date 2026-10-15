import { readFile } from "node:fs/promises";
import { defineBenchmark } from "../../src/benchmark.js";
import { exactMatch } from "../../src/graders.js";
import type { Task } from "../../src/types.js";

async function loadTasks(): Promise<Task[]> {
  const url = new URL("../examples/echo/data/tasks.jsonl", import.meta.url);
  return (await readFile(url, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Task);
}
export const echoBenchmark = defineBenchmark({
  id: "benchmark-core", name: "Arithmetic word problems", tagline: "Small arithmetic, full benchmark stack.",
  tags: ["helpful", "science"], category: "reasoning", whatItMeasures: "Exact answers to short addition and subtraction word problems.",
  version: "0.1.0", status: "alpha", loadTasks, grade: (task, submission) => submission.answer === undefined ? { score: 0, reason: "Submission has no answer." } : exactMatch(task.expected ?? null, submission.answer),
  provenance: [{
    name: "Seeded arithmetic generator", kind: "synthetic", url: "https://github.com/pooriaarab/benchmark-core/blob/main/examples/echo/scripts/generate.mjs",
    licence: "MIT", howToGet: "Run `node examples/echo/scripts/generate.mjs` from the repository root.", retrievedAt: "2026-10-15T00:00:00.000Z",
    contaminationNotes: "Generated with seed 20261015. Future public releases keep a separately seeded hidden split after the 2026-10-15 cutoff.",
    refresh: "Change the committed seed, run the generator, and review the JSONL diff.",
  }], gradingMethod: "Exact string match against the generated integer answer.", shareCardTitle: "Arithmetic word problems",
});
