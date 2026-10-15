import type { Benchmark, IndexEntry, Task } from "./types.js";
export async function indexEntry<T extends Task>(benchmark: Benchmark<T>): Promise<IndexEntry> {
  const definition = benchmark.definition; const tasks = await benchmark.listTasks();
  const date = definition.provenance.map((item) => item.retrievedAt).sort().at(-1) ?? new Date(0).toISOString();
  const entry: IndexEntry = {
    id: definition.id, name: definition.name, tagline: definition.tagline, tags: definition.tags,
    category: definition.category, what_it_measures: definition.whatItMeasures,
    npm: definition.id, repo: `https://github.com/pooriaarab/${definition.id}`,
    docs: `https://private-repo-337e.com/benchmarks/${definition.id}`, version: definition.version,
    task_count: tasks.length, data_sources: definition.provenance.map(({ name, kind, licence, url }) => ({ name, kind, licence, url })),
    grader: definition.gradingMethod, status: definition.status, created: date.slice(0, 10), updated: date.slice(0, 10),
    share_card: `https://private-repo-337e.com/benchmarks/${definition.id}/card.svg`,
  };
  if (definition.saturation !== undefined) entry.saturation = definition.saturation;
  return entry;
}
export function provenanceMarkdown<T extends Task>(benchmark: Benchmark<T>): string {
  const lines = [`# ${benchmark.definition.name} provenance`, "", "This file is generated from the benchmark definition.", ""];
  for (const source of benchmark.definition.provenance) lines.push(`## ${source.name}`, "", `- Kind: \`${source.kind}\``, `- URL: ${source.url}`, `- Licence: \`${source.licence}\``, `- Retrieved: ${source.retrievedAt}`, `- How to get it: ${source.howToGet}`, `- Contamination notes: ${source.contaminationNotes}`, `- Refresh: ${source.refresh}`, "");
  return lines.join("\n");
}
