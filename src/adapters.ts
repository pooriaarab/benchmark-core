import type { ChatMessage, ChatRequest, ChatResult, CompletionResult, JsonValue, MockPolicies, ModelAdapter, ModelUsage, Task, ToolCall } from "./types.js";

function hash(text: string): number { let value = 2166136261; for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }
export function mockAdapter<T extends Task = Task>(options: { seed?: number; policies?: MockPolicies<T> } = {}): ModelAdapter {
  const seed = options.seed ?? 1; const good = (task: Task): boolean => ((hash(task.id) ^ seed) & 1) === 1;
  return {
    id: `mock:${seed}`,
    async complete(prompt, context) {
      const expected = context.task.expected; const content = good(context.task) && typeof expected === "string" ? expected : "__mock_incorrect__";
      return { content, usage: { inputTokens: prompt.length, outputTokens: 1, totalTokens: prompt.length + 1, costUsd: 0 }, costUsd: 0 };
    },
    async chat(request, context) {
      const task = context.task as T; const turn = context.turn ?? 1;
      const policy = good(task) ? options.policies?.good(task) : options.policies?.bad(task);
      const scripted = policy?.[turn - 1];
      if (!scripted && options.policies) throw new Error(`Mock policy has no scripted turn ${turn} for task ${task.id}.`);
      const selected = scripted ?? { content: "__mock_incorrect__" };
      const toolCalls = (selected.toolCalls ?? []).map((call, index) => ({ id: call.id ?? `mock-${turn}-${index + 1}`, name: call.name, args: call.args }));
      const content = selected.content ?? ""; const inputTokens = request.messages.reduce((sum, message) => sum + message.content.length, 0);
      return { content, toolCalls, usage: { inputTokens, outputTokens: content.length, totalTokens: inputTokens + content.length, costUsd: 0 }, costUsd: 0 };
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
  if (inputTokens !== undefined) usage.inputTokens = inputTokens; if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (totalTokens !== undefined) usage.totalTokens = totalTokens; if (costUsd !== undefined) usage.costUsd = costUsd;
  return usage;
}
function toolCallsFrom(value: unknown): ToolCall[] {
  if (value === undefined) return []; if (!Array.isArray(value)) throw new Error("Model tool_calls is not an array.");
  return value.map((item, index) => {
    const call = record(item, `tool call ${index}`); const fn = record(call.function, `tool call ${index} function`);
    if (typeof call.id !== "string" || typeof fn.name !== "string" || typeof fn.arguments !== "string") throw new Error(`Invalid tool call ${index}.`);
    const parsed: unknown = JSON.parse(fn.arguments); const args = record(parsed, `tool call ${index} arguments`) as Record<string, JsonValue>;
    return { id: call.id, name: fn.name, args };
  });
}
function messagesForApi(messages: ChatMessage[]): unknown[] {
  return messages.map((message) => ({ role: message.role, content: message.content, ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}), ...(message.toolCalls ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } })) } : {}) }));
}
async function requestChat(url: string, apiKey: string, model: string, request: Pick<ChatRequest, "messages" | "tools">, signal: AbortSignal, headers: Record<string, string> = {}): Promise<ChatResult> {
  const tools = request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  const response = await fetch(url, { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...headers }, body: JSON.stringify({ model, messages: messagesForApi(request.messages), ...(tools.length ? { tools } : {}) }) });
  if (!response.ok) throw new Error(`Model API returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const body: unknown = await response.json(); const raw = record(body, "model");
  if (!Array.isArray(raw.choices) || raw.choices.length === 0) throw new Error("Model response has no choices.");
  const choice = record(raw.choices[0], "choice"); const message = record(choice.message, "message");
  if (message.content !== null && typeof message.content !== "string") throw new Error("Model response content is not text.");
  const usage = usageFrom(raw.usage); const result: ChatResult = { content: message.content ?? "", toolCalls: toolCallsFrom(message.tool_calls) };
  if (usage) result.usage = usage; if (usage?.costUsd !== undefined) result.costUsd = usage.costUsd;
  return result;
}
function remoteAdapter(id: string, url: () => string, key: () => string | undefined, model: string, headers: Record<string, string> = {}): ModelAdapter {
  const invoke = async (request: Pick<ChatRequest, "messages" | "tools">, signal: AbortSignal): Promise<ChatResult> => {
    const apiKey = key(); if (!apiKey) throw new Error(`${id.startsWith("openrouter") ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY"} is required.`);
    return requestChat(url(), apiKey, model, request, signal, headers);
  };
  return {
    id,
    async complete(prompt, context): Promise<CompletionResult> { const result = await invoke({ messages: [{ role: "user", content: prompt }], tools: [] }, context.signal); return { content: result.content, ...(result.usage ? { usage: result.usage } : {}), ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}) }; },
    async chat(request, context) { return invoke(request, context.signal); },
  };
}
export function openrouterAdapter(options: { model: string; apiKey?: string }): ModelAdapter {
  return remoteAdapter(`openrouter:${options.model}`, () => "https://openrouter.ai/api/v1/chat/completions", () => options.apiKey ?? process.env.OPENROUTER_API_KEY, options.model, { "HTTP-Referer": "https://aibenchmarkindex.com", "X-Title": "benchmark-core" });
}
export function openaiCompatAdapter(options: { baseUrl?: string; model: string; apiKey?: string }): ModelAdapter {
  return remoteAdapter(`openai:${options.model}`, () => { const base = options.baseUrl ?? process.env.OPENAI_BASE_URL; if (!base) throw new Error("OPENAI_BASE_URL is required."); return `${base.replace(/\/$/, "")}/chat/completions`; }, () => options.apiKey ?? process.env.OPENAI_API_KEY, options.model);
}
