import type { Answer, ModelAdapter, ModelResult, ModelUsage, Task } from "./types.js";

function hash(text: string): number { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }
export function mockAdapter(options: { seed?: number } = {}): ModelAdapter {
  const seed = options.seed ?? 1;
  return {
    id: `mock:${seed}`,
    async generate(task) {
      const correct = ((hash(task.id) ^ seed) & 1) === 0;
      const good = task.expected ?? task.metadata?.expected ?? task.prompt;
      return { answer: correct ? good : "__mock_incorrect__", usage: { inputTokens: task.prompt.length, outputTokens: 1, totalTokens: task.prompt.length + 1, costUsd: 0 } };
    },
  };
}

type UnknownRecord = Record<string, unknown>;
function record(value: unknown, label: string): UnknownRecord { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} response is not an object.`); return value as UnknownRecord; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function usageFrom(value: unknown): ModelUsage | undefined {
  if (value === undefined) return undefined;
  const raw = record(value, "usage"); const usage: ModelUsage = {};
  const inputTokens = number(raw.prompt_tokens); const outputTokens = number(raw.completion_tokens); const totalTokens = number(raw.total_tokens); const costUsd = number(raw.cost);
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens;
  if (costUsd !== undefined) usage.costUsd = costUsd;
  return usage;
}
function answerFrom(payload: unknown): Answer {
  const body = record(payload, "model");
  if (!Array.isArray(body.choices) || body.choices.length === 0) throw new Error("Model response has no choices.");
  const choice = record(body.choices[0], "choice"); const message = record(choice.message, "message");
  if (typeof message.content !== "string") throw new Error("Model response content is not text.");
  return message.content;
}
async function chat(url: string, apiKey: string, model: string, task: Task, signal: AbortSignal, headers: Record<string, string> = {}): Promise<ModelResult> {
  const response = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...headers }, body: JSON.stringify({ model, messages: [{ role: "user", content: task.prompt }] }) });
  if (!response.ok) throw new Error(`Model API returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const body: unknown = await response.json(); const result: ModelResult = { answer: answerFrom(body) };
  const usage = usageFrom(record(body, "model").usage); if (usage) result.usage = usage;
  return result;
}
export function openrouterAdapter(options: { model: string; apiKey?: string }): ModelAdapter {
  return { id: `openrouter:${options.model}`, async generate(task, context) {
    const key = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("OPENROUTER_API_KEY is required for the OpenRouter adapter.");
    return chat("https://openrouter.ai/api/v1/chat/completions", key, options.model, task, context.signal, { "HTTP-Referer": "https://private-repo-337e.com", "X-Title": "benchmark-core" });
  } };
}
export function openaiCompatAdapter(options: { baseUrl?: string; model: string; apiKey?: string }): ModelAdapter {
  return { id: `openai:${options.model}`, async generate(task, context) {
    const baseUrl = options.baseUrl ?? process.env.OPENAI_BASE_URL;
    const key = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!baseUrl) throw new Error("OPENAI_BASE_URL is required for the OpenAI-compatible adapter.");
    if (!key) throw new Error("OPENAI_API_KEY is required for the OpenAI-compatible adapter.");
    return chat(`${baseUrl.replace(/\/$/, "")}/chat/completions`, key, options.model, task, context.signal);
  } };
}
