import { createServer, type Server } from "node:http";
import { indexEntry } from "./metadata.js";
import type { Benchmark, Task, Trace } from "./types.js";

const LIMIT = 1_048_576;
function json(value: unknown, status = 200, cors = false): Response { return Response.json(value, { status, ...(cors ? { headers: { "access-control-allow-origin": "*" } } : {}) }); }
function error(code: string, message: string, status: number, cors = false): Response { return json({ error: { code, message } }, status, cors); }
async function body(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0); if (length > LIMIT) throw new Error("REQUEST_TOO_LARGE");
  if (!request.body) return {};
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > LIMIT) { await reader.cancel(); throw new Error("REQUEST_TOO_LARGE"); } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; } catch { throw new Error("INVALID_JSON"); }
}
function object(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function trace(value: unknown): Trace | undefined { const raw = object(value); if (!raw || (raw.answer !== undefined && typeof raw.answer !== "string") || (raw.toolLog !== undefined && !Array.isArray(raw.toolLog))) return undefined; return raw as Trace; }
export function createHandler<T extends Task>(benchmark: Benchmark<T>) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url); const cors = request.method === "GET";
    try {
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, benchmark: benchmark.definition.id, version: benchmark.definition.version }, 200, true);
      if (request.method === "GET" && url.pathname === "/v1/tasks") return json({ tasks: await benchmark.listTasks() }, 200, true);
      if (request.method === "GET" && url.pathname.startsWith("/v1/tasks/")) {
        const task = await benchmark.getTask(decodeURIComponent(url.pathname.slice(10)));
        return task ? json({ task }, 200, true) : error("NOT_FOUND", "Task not found.", 404, true);
      }
      if (request.method === "POST" && url.pathname === "/v1/score") {
        const payload = object(await body(request)); const taskId = payload?.taskId; const submission = trace(payload?.submission);
        if (typeof taskId !== "string" || !submission) return error("INVALID_REQUEST", "taskId and submission are required.", 400);
        const task = await benchmark.getTask(taskId); if (!task) return error("NOT_FOUND", "Task not found.", 404);
        return json({ taskId, ...(await benchmark.score(task, submission, typeof payload?.seed === "number" ? { seed: payload.seed } : {})) });
      }
      if (request.method === "GET" && url.pathname === "/v1/provenance") return json({ provenance: benchmark.definition.provenance }, 200, true);
      if (request.method === "GET" && url.pathname === "/v1/index-entry") return json(await indexEntry(benchmark), 200, true);
      return error("NOT_FOUND", "Route not found.", 404, cors);
    } catch (caught) {
      if (caught instanceof Error && caught.message === "REQUEST_TOO_LARGE") return error("REQUEST_TOO_LARGE", `Request bodies may not exceed ${LIMIT} bytes.`, 413);
      if (caught instanceof Error && caught.message === "INVALID_JSON") return error("INVALID_JSON", "Request body must be valid JSON.", 400);
      console.error("benchmark-core handler error", caught); return error("INTERNAL_ERROR", "Unexpected server error.", 500, cors);
    }
  };
}
export async function serve(handler: (request: Request) => Promise<Response>, options: { port: number; hostname?: string }): Promise<Server> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of incoming) { const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk; size += bytes.byteLength; if (size > LIMIT) { outgoing.writeHead(413, { "content-type": "application/json" }); outgoing.end(JSON.stringify({ error: { code: "REQUEST_TOO_LARGE", message: `Request bodies may not exceed ${LIMIT} bytes.` } })); return; } chunks.push(bytes); }
      const init: RequestInit = { method: incoming.method ?? "GET", headers: incoming.headers as HeadersInit };
      if (size) init.body = Buffer.concat(chunks);
      const response = await handler(new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, init));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (caught) { console.error("benchmark-core server error", caught); outgoing.writeHead(500, { "content-type": "application/json" }); outgoing.end(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } })); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port, options.hostname ?? "127.0.0.1", resolve); });
  return server;
}
