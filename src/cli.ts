#!/usr/bin/env node
import { createCli } from "./cli-factory.js";
import { echoBenchmark } from "../examples/echo/benchmark.js";
process.exitCode = await createCli(echoBenchmark, { bin: "benchmark-core" }).main(process.argv.slice(2));
