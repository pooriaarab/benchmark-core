import type { JsonValue, ModelAdapter, Task, TaskScore, Trace } from "./types.js";

const shown = (value: JsonValue): string => typeof value === "string" ? value : JSON.stringify(value);
export function exactMatch(expected: JsonValue, answer: JsonValue): TaskScore {
  const pass = JSON.stringify(expected) === JSON.stringify(answer);
  return { score: pass ? 1 : 0, reason: pass ? "Exact match." : `Expected ${shown(expected)}; received ${shown(answer)}.` };
}
export function regexMatch(pattern: RegExp | string, answer: JsonValue): TaskScore {
  const regex = typeof pattern === "string" ? new RegExp(pattern) : new RegExp(pattern.source, pattern.flags);
  const pass = typeof answer === "string" && regex.test(answer);
  return { score: pass ? 1 : 0, reason: pass ? `Matched ${regex}.` : `Answer did not match ${regex}.` };
}
export function numericWithin(expected: number, tolerance: number, answer: JsonValue): TaskScore {
  if (tolerance < 0) throw new Error("tolerance must be non-negative.");
  const actual = typeof answer === "number" ? answer : typeof answer === "string" ? Number(answer.trim()) : Number.NaN;
  const pass = Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  return { score: pass ? 1 : 0, reason: pass ? `Within ${tolerance} of ${expected}.` : `Expected ${expected} ± ${tolerance}; received ${shown(answer)}.` };
}

export interface JsonSchema { type?: "null" | "boolean" | "number" | "integer" | "string" | "array" | "object"; enum?: JsonValue[]; required?: string[]; properties?: Record<string, JsonSchema>; items?: JsonSchema; additionalProperties?: boolean; pattern?: string; minimum?: number; maximum?: number; }
function validate(schema: JsonSchema, value: JsonValue, path: string): string | undefined {
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) return `${path} is not in enum`;
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type && !(schema.type === "integer" ? typeof value === "number" && Number.isInteger(value) : actual === schema.type)) return `${path} must be ${schema.type}`;
  if (typeof value === "number" && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return `${path} is outside numeric bounds`;
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} does not match pattern`;
  if (Array.isArray(value) && schema.items) for (let index = 0; index < value.length; index++) { const issue = validate(schema.items, value[index]!, `${path}[${index}]`); if (issue) return issue; }
  if (value !== null && !Array.isArray(value) && typeof value === "object") {
    for (const key of schema.required ?? []) if (!(key in value)) return `${path}.${key} is required`;
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) { const issue = validate(child, value[key]!, `${path}.${key}`); if (issue) return issue; }
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) return `${path}.${key} is not allowed`;
  }
  return undefined;
}
export function jsonSchemaMatch(schema: JsonSchema, answer: JsonValue): TaskScore {
  const issue = validate(schema, answer, "$ ".trim());
  return { score: issue ? 0 : 1, reason: issue ?? "Answer matches the JSON schema." };
}

export const DEFAULT_JUDGE_PROMPT = "Score the candidate answer from 0 to 1. Return only JSON with numeric score and string reason.";
export function judgeWithLLM(adapter: ModelAdapter, prompt = DEFAULT_JUDGE_PROMPT) {
  return async (task: Task, submission: Trace): Promise<TaskScore> => {
    const controller = new AbortController();
    const judgeTask: Task = { id: `judge:${task.id}`, kind: "single", prompt: `${prompt}\n\nTask: ${task.prompt}\nCandidate trace: ${JSON.stringify(submission)}` };
    const result = await adapter.complete(judgeTask.prompt, { signal: controller.signal, attempt: 1, task: judgeTask, seed: 1 });
    const raw = JSON.parse(result.content) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Judge returned a non-object response.");
    const score = Reflect.get(raw, "score"); const reason = Reflect.get(raw, "reason");
    if (typeof score !== "number" || score < 0 || score > 1 || typeof reason !== "string") throw new Error("Judge response must contain score (0..1) and reason.");
    return { score, reason };
  };
}
