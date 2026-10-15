export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Answer = string;

export interface Task {
  id: string; kind: "single" | "episode"; prompt: string;
  input?: JsonValue; expected?: JsonValue; metadata?: Record<string, JsonValue>;
}
export interface ToolSpec { name: string; description: string; parameters: JsonSchemaObject; }
export interface JsonSchemaObject { type: "object"; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; }
export interface ToolError { code: string; message: string; }
export interface ToolResult { result: unknown; error?: ToolError; }
export interface ToolLogEntry { name: string; args: Record<string, JsonValue>; result: unknown; error?: ToolError; }
export interface EnvironmentStart { system: string; tools: ToolSpec[]; }
export interface Environment<T extends Task = Task> {
  reset(task: T, seed: number): EnvironmentStart | Promise<EnvironmentStart>;
  callTool(name: string, args: Record<string, JsonValue>): ToolResult | Promise<ToolResult>;
  state(): unknown; done(): boolean;
}
export interface Trace { answer?: string; toolLog?: ToolLogEntry[]; finalState?: unknown; }
export interface TaskScore { score: number; reason: string; details?: JsonValue; }
export interface GradeContext { signal?: AbortSignal; seed: number; }
export type ProvenanceKind = "synthetic" | "public-dataset" | "human-written" | "live-feed" | "commissioned";
export interface Provenance {
  name: string; kind: ProvenanceKind; url: string; licence: string; howToGet: string;
  retrievedAt: string; contaminationNotes: string; refresh: string;
}
export type BenchmarkTag = "helpful" | "viral" | "silly" | "science";
export type BenchmarkStatus = "alpha" | "beta" | "stable";
export interface ScriptedTurn { content?: string; toolCalls?: Array<{ id?: string; name: string; args: Record<string, JsonValue> }>; }
export interface MockPolicies<T extends Task = Task> { good(task: T): ScriptedTurn[]; bad(task: T): ScriptedTurn[]; }

export interface BenchmarkDefinition<T extends Task = Task> {
  id: string; name: string; tagline: string; tags: BenchmarkTag[]; category: string;
  whatItMeasures: string; version: string; status: BenchmarkStatus;
  tasks?: readonly T[]; loadTasks?: () => Promise<readonly T[]>;
  grade: (task: T, submission: Trace, context: GradeContext) => TaskScore | Promise<TaskScore>;
  environment?: (task: T) => Environment<T>; mockPolicies?: MockPolicies<T>;
  provenance: Provenance[]; gradingMethod: string; saturation?: number; shareCardTitle?: string;
}
export interface Benchmark<T extends Task = Task> {
  readonly definition: Readonly<BenchmarkDefinition<T>>;
  listTasks(): Promise<readonly T[]>; getTask(id: string): Promise<T | undefined>;
  score(task: T, submission: Trace, context?: Partial<GradeContext>): Promise<TaskScore>;
}

export interface ModelUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number; }
export interface ModelAdapterContext { signal: AbortSignal; attempt: number; task: Task; seed: number; turn?: number; }
export interface CompletionResult { content: string; usage?: ModelUsage; costUsd?: number; }
export type MessageRole = "system" | "user" | "assistant" | "tool";
export interface ChatMessage { role: MessageRole; content: string; toolCallId?: string; toolCalls?: ToolCall[]; }
export interface ToolCall { id: string; name: string; args: Record<string, JsonValue>; }
export interface ChatRequest { messages: ChatMessage[]; tools: ToolSpec[]; }
export interface ChatResult { content: string; toolCalls: ToolCall[]; usage?: ModelUsage; costUsd?: number; }
export interface ModelAdapter {
  id: string;
  complete(prompt: string, context: ModelAdapterContext): Promise<CompletionResult>;
  chat(request: ChatRequest, context: ModelAdapterContext): Promise<ChatResult>;
}
export interface Episode {
  transcript: ChatMessage[]; toolLog: ToolLogEntry[]; finalAnswer?: string; finalState: unknown;
  usage: ModelUsage; costUsd: number; turns: number; aborted?: "budget" | "max_turns" | "max_tool_calls";
}
export interface EpisodeOptions { maxTurns: number; maxToolCalls: number; budgetUsd: number; seed?: number; signal?: AbortSignal; }
export interface RunRow {
  taskId: string; kind: Task["kind"]; submission?: Trace; episode?: Episode; score: number; reason: string; attempts: number;
  latencyMs: number; usage?: ModelUsage; error?: string;
}
export interface RunReport {
  benchmark: { id: string; name: string; version: string }; model: string; startedAt: string; completedAt: string; mean: number;
  confidenceInterval95: { low: number; high: number }; seed: number;
  totals: { tasks: number; passed: number; failed: number; latencyMs: number; costUsd?: number; inputTokens?: number; outputTokens?: number };
  rows: RunRow[];
}
export interface RunOptions { concurrency?: number; timeoutMs?: number; retries?: number; seed?: number; maxTurns?: number; maxToolCalls?: number; budgetUsd?: number; }
export interface IndexEntry {
  id: string; name: string; tagline: string; tags: BenchmarkTag[]; category: string; what_it_measures: string;
  npm: string; repo: string; docs: string; version: string; task_count: number;
  data_sources: Array<Pick<Provenance, "name" | "kind" | "licence" | "url">>;
  grader: string; status: BenchmarkStatus; saturation?: number; created: string; updated: string; share_card: string;
}
