import type { ChatMessage, Environment, Episode, EpisodeOptions, ModelAdapter, ModelUsage, Task, ToolLogEntry } from "./types.js";

function addUsage(total: ModelUsage, next: ModelUsage | undefined): void {
  if (!next) return;
  for (const key of ["inputTokens", "outputTokens", "totalTokens"] as const) if (next[key] !== undefined) total[key] = (total[key] ?? 0) + next[key]!;
}
export async function replay<T extends Task>(environment: Environment<T>, task: T, toolLog: readonly ToolLogEntry[], seed = 1): Promise<unknown> {
  await environment.reset(task, seed);
  for (const entry of toolLog) await environment.callTool(entry.name, entry.args);
  return environment.state();
}
export async function runEpisode<T extends Task>(task: T, adapter: ModelAdapter, environment: Environment<T>, options: EpisodeOptions): Promise<Episode> {
  if (!Number.isInteger(options.maxTurns) || options.maxTurns < 1 || !Number.isInteger(options.maxToolCalls) || options.maxToolCalls < 0 || options.budgetUsd < 0) throw new Error("Invalid episode options.");
  const seed = options.seed ?? 1; const start = await environment.reset(task, seed);
  const transcript: ChatMessage[] = [{ role: "system", content: start.system }, { role: "user", content: task.prompt }];
  const toolLog: ToolLogEntry[] = []; const usage: ModelUsage = {}; let costUsd = 0; let turns = 0; let finalAnswer: string | undefined; let aborted: Episode["aborted"];
  while (turns < options.maxTurns) {
    options.signal?.throwIfAborted(); turns++;
    const result = await adapter.chat({ messages: [...transcript], tools: start.tools }, { signal: options.signal ?? new AbortController().signal, attempt: 1, task, seed, turn: turns });
    addUsage(usage, result.usage); costUsd += result.costUsd ?? result.usage?.costUsd ?? 0;
    transcript.push({ role: "assistant", content: result.content, ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}) });
    if (costUsd > options.budgetUsd) {
      aborted = "budget"; for (const call of result.toolCalls) transcript.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: "episode_ended" }) }); break;
    }
    if (result.toolCalls.length === 0) { finalAnswer = result.content; break; }
    let ended = false;
    for (let index = 0; index < result.toolCalls.length; index++) {
      const call = result.toolCalls[index]!;
      if (toolLog.length >= options.maxToolCalls) { aborted = "max_tool_calls"; for (const skipped of result.toolCalls.slice(index)) transcript.push({ role: "tool", toolCallId: skipped.id, content: JSON.stringify({ error: "episode_ended" }) }); ended = true; break; }
      const outcome = await environment.callTool(call.name, call.args); const entry: ToolLogEntry = { name: call.name, args: call.args, result: outcome.result, ...(outcome.error ? { error: outcome.error } : {}) };
      toolLog.push(entry); transcript.push({ role: "tool", toolCallId: call.id, content: JSON.stringify(outcome.error ? { error: outcome.error } : outcome.result) ?? "null" });
      if (environment.done()) { for (const skipped of result.toolCalls.slice(index + 1)) transcript.push({ role: "tool", toolCallId: skipped.id, content: JSON.stringify({ error: "episode_ended" }) }); ended = true; break; }
    }
    if (aborted || ended) break;
  }
  if (!finalAnswer && !aborted && turns >= options.maxTurns) aborted = "max_turns";
  if (costUsd || usage.costUsd !== undefined) usage.costUsd = costUsd;
  return { transcript, toolLog, ...(finalAnswer !== undefined ? { finalAnswer } : {}), finalState: environment.state(), usage, costUsd, turns, ...(aborted ? { aborted } : {}) };
}
