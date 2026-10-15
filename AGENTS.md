# Working on benchmark-core

benchmark-core is the shared execution engine for the benchmark family.

## Commands

- Install with `npm ci`.
- Run the full gate with `npm run ci:local`.
- Regenerate example tasks with `node examples/echo/scripts/generate.mjs`.
- Never add unit tests. Extend `scripts/e2e.mjs` through a public surface.

## Contract rules

Keep exported JSON shapes stable and TypeScript strict. Fail with explicit errors instead of fallback values.

Keep runtime dependencies near zero. The official MCP SDK is the only approved runtime dependency.

A benchmark definition is the source of truth for tasks, grading, and provenance. Update `examples/echo/data/PROVENANCE.md` with `provenanceMarkdown` output.

Do not read provider keys from repository files. OpenRouter uses `OPENROUTER_API_KEY`. OpenAI-compatible endpoints use `OPENAI_BASE_URL` and `OPENAI_API_KEY`.

## Pull requests

Open an issue first. Use branch `bmc-<issue>-<slug>` and title `[BMC-<issue>] Imperative subject`.

Keep one concern under 500 counted lines. Run `npm run ci:local` before each push. Do not push the `release` branch or merge your own pull request.
