export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Answer = JsonValue;

export interface Task {
  id: string;
  prompt: string;
  input?: JsonValue;
  expected?: JsonValue;
  metadata?: Record<string, JsonValue>;
}

export interface TaskScore {
  score: number;
  reason: string;
  details?: JsonValue;
}

export interface GradeContext { signal?: AbortSignal; }
export type ProvenanceKind = "synthetic" | "public-dataset" | "human-written" | "live-feed" | "commissioned";
export interface Provenance {
  name: string; kind: ProvenanceKind; url: string; licence: string; howToGet: string;
  retrievedAt: string; contaminationNotes: string; refresh: string;
}
export type BenchmarkTag = "helpful" | "viral" | "silly" | "science";
export type BenchmarkStatus = "alpha" | "beta" | "stable";

export interface BenchmarkDefinition<T extends Task = Task> {
  id: string; name: string; tagline: string; tags: BenchmarkTag[]; category: string;
  whatItMeasures: string; version: string; status: BenchmarkStatus;
  tasks?: readonly T[]; loadTasks?: () => Promise<readonly T[]>;
  grade: (task: T, answer: Answer, context: GradeContext) => TaskScore | Promise<TaskScore>;
  provenance: Provenance[]; gradingMethod: string; saturation?: number; shareCardTitle?: string;
}

export interface Benchmark<T extends Task = Task> {
  readonly definition: Readonly<BenchmarkDefinition<T>>;
  listTasks(): Promise<readonly T[]>;
  getTask(id: string): Promise<T | undefined>;
  score(task: T, answer: Answer, context?: GradeContext): Promise<TaskScore>;
}

export interface ModelUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUsd?: number; }
export interface ModelResult { answer: Answer; usage?: ModelUsage; }
export interface ModelAdapterContext { signal: AbortSignal; attempt: number; }
export interface ModelAdapter {
  id: string;
  generate(task: Task, context: ModelAdapterContext): Promise<ModelResult>;
}
export interface RunRow {
  taskId: string; answer?: Answer; score: number; reason: string; attempts: number;
  latencyMs: number; usage?: ModelUsage; error?: string;
}
export interface RunReport {
  benchmark: { id: string; name: string; version: string };
  model: string; startedAt: string; completedAt: string; mean: number;
  confidenceInterval95: { low: number; high: number }; seed: number;
  totals: { tasks: number; passed: number; failed: number; latencyMs: number; costUsd?: number; inputTokens?: number; outputTokens?: number };
  rows: RunRow[];
}
export interface RunOptions { concurrency?: number; timeoutMs?: number; retries?: number; seed?: number; }

export interface IndexEntry {
  id: string; name: string; tagline: string; tags: BenchmarkTag[]; category: string;
  what_it_measures: string; npm: string; repo: string; docs: string; version: string;
  task_count: number; data_sources: Array<Pick<Provenance, "name" | "kind" | "licence" | "url">>;
  grader: string; status: BenchmarkStatus; saturation?: number; created: string; updated: string; share_card: string;
}
