import assert from "node:assert/strict";
import { defineBenchmark, exactMatch, mockAdapter, run } from "../dist/index.js";
const tasks = Array.from({ length: 4 }, (_, index) => ({ id: String(index), prompt: `Return ${index}`, expected: String(index) }));
const benchmark = defineBenchmark({ id: "smoke", name: "Smoke", tagline: "Smoke", tags: ["science"], category: "test", whatItMeasures: "Core execution", version: "0.1.0", status: "alpha", tasks, grade: (task, answer) => exactMatch(task.expected, answer), provenance: [], gradingMethod: "exact match" });
const report = await run(benchmark, mockAdapter({ seed: 1 }), { concurrency: 2 });
assert.equal(report.rows.length, 4);
assert.ok(report.mean > 0 && report.mean < 1);
console.log(`core e2e: ${report.rows.length} tasks, mean ${report.mean}`);
