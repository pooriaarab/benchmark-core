import { createCli, defineBenchmark, exactMatch } from "../dist/index.js";
const tasks = Array.from({ length: 4 }, (_, index) => ({ id: String(index), prompt: `Return ${index}`, expected: String(index) }));
const benchmark = defineBenchmark({ id: "smoke", name: "Smoke", tagline: "Smoke", tags: ["science"], category: "test", whatItMeasures: "Core execution", version: "0.1.0", status: "alpha", tasks, grade: (task, answer) => exactMatch(task.expected, answer), provenance: [], gradingMethod: "exact match" });
process.exitCode = await createCli(benchmark, { bin: "e2e-cli" }).main(process.argv.slice(2));
