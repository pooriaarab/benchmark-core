import { bootstrapCI } from "./random.js";
import type { Benchmark, ModelAdapter, ModelResult, RunOptions, RunReport, RunRow, Task } from "./types.js";

async function timedGenerate(adapter: ModelAdapter, task: Task, attempt: number, timeoutMs: number): Promise<ModelResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => { const error = new Error(`Task timed out after ${timeoutMs}ms.`); controller.abort(error); reject(error); }, timeoutMs);
  });
  try { return await Promise.race([adapter.generate(task, { signal: controller.signal, attempt }), expired]); }
  finally { if (timeout !== undefined) clearTimeout(timeout); }
}

export async function run<T extends Task>(benchmark: Benchmark<T>, adapter: ModelAdapter, options: RunOptions = {}): Promise<RunReport> {
  const concurrency = options.concurrency ?? 1; const timeoutMs = options.timeoutMs ?? 60_000;
  const retries = options.retries ?? 0; const seed = options.seed ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(retries) || retries < 0) throw new Error("Invalid run options.");
  const tasks = [...await benchmark.listTasks()]; const rows: Array<RunRow | undefined> = Array.from({ length: tasks.length }); let next = 0;
  const startedAt = new Date().toISOString(); const wallStart = performance.now();
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next++; const task = tasks[index]!; const start = performance.now(); let attempts = 0; let lastError: unknown;
      while (attempts <= retries) {
        attempts++;
        try {
          const result = await timedGenerate(adapter, task, attempts, timeoutMs);
          const grade = await benchmark.score(task, result.answer);
          rows[index] = { taskId: task.id, answer: result.answer, score: grade.score, reason: grade.reason, attempts, latencyMs: Math.round(performance.now() - start), ...(result.usage ? { usage: result.usage } : {}) };
          lastError = undefined; break;
        } catch (error) { lastError = error; }
      }
      if (lastError !== undefined) {
        const message = lastError instanceof Error ? lastError.message : String(lastError);
        rows[index] = { taskId: task.id, score: 0, reason: `Run failed: ${message}`, attempts, latencyMs: Math.round(performance.now() - start), error: message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, tasks.length)) }, worker));
  const completeRows = rows.filter((row): row is RunRow => row !== undefined); const scores = completeRows.map((row) => row.score);
  const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const usage = completeRows.map((row) => row.usage).filter((item) => item !== undefined);
  const sum = (key: "costUsd" | "inputTokens" | "outputTokens"): number | undefined => usage.some((item) => item[key] !== undefined) ? usage.reduce((total, item) => total + (item[key] ?? 0), 0) : undefined;
  const totals: RunReport["totals"] = { tasks: completeRows.length, passed: completeRows.filter((row) => row.score === 1).length, failed: completeRows.filter((row) => row.error !== undefined).length, latencyMs: Math.round(performance.now() - wallStart) };
  const costUsd = sum("costUsd"); const inputTokens = sum("inputTokens"); const outputTokens = sum("outputTokens");
  if (costUsd !== undefined) totals.costUsd = costUsd; if (inputTokens !== undefined) totals.inputTokens = inputTokens; if (outputTokens !== undefined) totals.outputTokens = outputTokens;
  return { benchmark: { id: benchmark.definition.id, name: benchmark.definition.name, version: benchmark.definition.version }, model: adapter.id, startedAt, completedAt: new Date().toISOString(), mean, confidenceInterval95: scores.length ? bootstrapCI(scores, seed) : { low: 0, high: 0 }, seed, totals, rows: completeRows };
}
