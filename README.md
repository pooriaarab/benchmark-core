# benchmark-core

The typed engine for building AI benchmarks with SDK, CLI, MCP, and HTTP API surfaces.

## Network safety

`serve` listens on `127.0.0.1` by default. Use `serve --host 0.0.0.0` only when a container or proxy needs an external bind.

`POST /v1/score` has no built-in authentication. Put authorization and rate limits in front of public deployments. An opt-in LLM-judged grader makes a paid model call for every score request.
