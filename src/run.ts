import { runEpisode } from "./episode.js";
import { bootstrapCI } from "./random.js";
import type { Benchmark, CompletionResult, Episode, ModelAdapter, ModelUsage, RunOptions, RunReport, RunRow, Task, Trace } from "./types.js";

async function timed<T>(timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController(); let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { const error = new Error(`Task timed out after ${timeoutMs}ms.`); controller.abort(error); reject(error); }, timeoutMs); });
  try { return await Promise.race([operation(controller.signal), expired]); } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
function usageWithCost(usage: ModelUsage | undefined, costUsd: number | undefined): ModelUsage | undefined {
  if (!usage && costUsd === undefined) return undefined; return { ...usage, ...(costUsd !== undefined ? { costUsd } : {}) };
}
export async function run<T extends Task>(benchmark: Benchmark<T>, adapter: ModelAdapter, options: RunOptions = {}): Promise<RunReport> {
  const concurrency = options.concurrency ?? 1; const timeoutMs = options.timeoutMs ?? 60_000; const retries = options.retries ?? 0; const seed = options.seed ?? 1;
  const maxTurns = options.maxTurns ?? 12; const maxToolCalls = options.maxToolCalls ?? 24; const budgetUsd = options.budgetUsd ?? Number.POSITIVE_INFINITY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(retries) || retries < 0) throw new Error("Invalid run options.");
  const tasks = [...await benchmark.listTasks()]; const rows: Array<RunRow | undefined> = Array.from({ length: tasks.length }); let next = 0;
  const startedAt = new Date().toISOString(); const wallStart = performance.now();
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const index = next++; const task = tasks[index]!; const start = performance.now(); let attempts = 0; let lastError: unknown;
      while (attempts <= retries) {
        attempts++;
        try {
          let submission: Trace; let usage: ModelUsage | undefined; let episode: Episode | undefined;
          if (task.kind === "episode") {
            if (!benchmark.definition.environment) throw new Error(`Episode task ${task.id} needs an environment.`);
            episode = await timed(timeoutMs, (signal) => runEpisode(task, adapter, benchmark.definition.environment!(task), { maxTurns, maxToolCalls, budgetUsd, seed, signal }));
            submission = { ...(episode.finalAnswer !== undefined ? { answer: episode.finalAnswer } : {}), toolLog: episode.toolLog, finalState: episode.finalState }; usage = usageWithCost(episode.usage, episode.costUsd);
          } else {
            const result: CompletionResult = await timed(timeoutMs, (signal) => adapter.complete(task.prompt, { signal, attempt: attempts, task, seed }));
            submission = { answer: result.content }; usage = usageWithCost(result.usage, result.costUsd);
          }
          const grade = await benchmark.score(task, submission, { seed });
          rows[index] = { taskId: task.id, kind: task.kind, submission, ...(episode ? { episode } : {}), score: grade.score, reason: grade.reason, attempts, latencyMs: Math.round(performance.now() - start), ...(usage ? { usage } : {}) };
          lastError = undefined; break;
        } catch (error) { lastError = error; }
      }
      if (lastError !== undefined) { const message = lastError instanceof Error ? lastError.message : String(lastError); rows[index] = { taskId: task.id, kind: task.kind, score: 0, reason: `Run failed: ${message}`, attempts, latencyMs: Math.round(performance.now() - start), error: message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, tasks.length)) }, worker));
  const completeRows = rows.filter((row): row is RunRow => row !== undefined); const scores = completeRows.map((row) => row.score); const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const usages = completeRows.map((row) => row.usage).filter((item) => item !== undefined); const sum = (key: "costUsd" | "inputTokens" | "outputTokens"): number | undefined => usages.some((item) => item[key] !== undefined) ? usages.reduce((total, item) => total + (item[key] ?? 0), 0) : undefined;
  const totals: RunReport["totals"] = { tasks: completeRows.length, passed: completeRows.filter((row) => row.score === 1).length, failed: completeRows.filter((row) => row.error !== undefined).length, latencyMs: Math.round(performance.now() - wallStart) };
  const costUsd = sum("costUsd"); const inputTokens = sum("inputTokens"); const outputTokens = sum("outputTokens"); if (costUsd !== undefined) totals.costUsd = costUsd; if (inputTokens !== undefined) totals.inputTokens = inputTokens; if (outputTokens !== undefined) totals.outputTokens = outputTokens;
  return { benchmark: { id: benchmark.definition.id, name: benchmark.definition.name, version: benchmark.definition.version }, model: adapter.id, startedAt, completedAt: new Date().toISOString(), mean, confidenceInterval95: scores.length ? bootstrapCI(scores, seed) : { low: 0, high: 0 }, seed, totals, rows: completeRows };
}
