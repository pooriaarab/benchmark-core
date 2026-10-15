import type { RunReport } from "./types.js";
const xml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function renderCard(report: RunReport): string {
  const score = `${Math.round(report.mean * 100)}%`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${xml(report.benchmark.name)} score ${score}"><rect width="1200" height="630" fill="#0b1020"/><text x="72" y="110" fill="#7dd3fc" font-family="system-ui,sans-serif" font-size="30">AI BENCHMARK INDEX</text><text x="72" y="220" fill="white" font-family="system-ui,sans-serif" font-size="58" font-weight="700">${xml(report.benchmark.name)}</text><text x="72" y="315" fill="#cbd5e1" font-family="system-ui,sans-serif" font-size="32">${xml(report.model)}</text><text x="72" y="490" fill="#a7f3d0" font-family="system-ui,sans-serif" font-size="120" font-weight="800">${score}</text><text x="72" y="575" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="25">private-repo-337e.com</text></svg>`;
}
export function renderMarkdown(report: RunReport): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const lines = [`# ${report.benchmark.name}`, "", `- Model: \`${report.model}\``, `- Score: **${percent(report.mean)}**`, `- 95% CI: ${percent(report.confidenceInterval95.low)}–${percent(report.confidenceInterval95.high)}`, `- Tasks: ${report.totals.tasks}`, "", "| Task | Score | Reason |", "| --- | ---: | --- |"];
  for (const row of report.rows) lines.push(`| ${row.taskId.replaceAll("|", "\\|")} | ${percent(row.score)} | ${row.reason.replaceAll("|", "\\|")} |`);
  return `${lines.join("\n")}\n`;
}
