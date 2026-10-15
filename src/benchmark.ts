import type { Answer, Benchmark, BenchmarkDefinition, GradeContext, Task } from "./types.js";

export function defineBenchmark<T extends Task>(definition: BenchmarkDefinition<T>): Benchmark<T> {
  if (definition.tasks === undefined && definition.loadTasks === undefined) throw new Error("A benchmark needs tasks or loadTasks().");
  if (definition.tasks !== undefined && definition.loadTasks !== undefined) throw new Error("Set tasks or loadTasks(), not both.");
  let loaded: Promise<readonly T[]> | undefined;
  const listTasks = async (): Promise<readonly T[]> => {
    loaded ??= definition.tasks ? Promise.resolve(definition.tasks) : definition.loadTasks!();
    const tasks = await loaded;
    const ids = new Set<string>();
    for (const task of tasks) {
      if (!task.id || ids.has(task.id)) throw new Error(`Invalid or duplicate task id: ${task.id}`);
      ids.add(task.id);
    }
    return tasks;
  };
  return {
    definition: Object.freeze(definition), listTasks,
    async getTask(id) { return (await listTasks()).find((task) => task.id === id); },
    async score(task: T, answer: Answer, context: GradeContext = {}) {
      const result = await definition.grade(task, answer, context);
      if (!Number.isFinite(result.score) || result.score < 0 || result.score > 1 || !result.reason) throw new Error(`Invalid score for task ${task.id}.`);
      return result;
    },
  };
}
