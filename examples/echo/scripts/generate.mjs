import { mkdir, writeFile } from "node:fs/promises";
const seed = 20261015;
let state = seed;
const random = () => { state += 0x6d2b79f5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
const people = ["Amina", "Diego", "Harper", "Jun", "Marta"];
const items = ["apples", "books", "marbles", "tickets", "seed packets"];
const tasks = Array.from({ length: 20 }, (_, index) => {
  const start = 8 + Math.floor(random() * 43); const change = 2 + Math.floor(random() * 8); const add = random() > 0.45;
  const person = people[index % people.length]; const item = items[Math.floor(index / people.length)];
  return { id: `arithmetic-${String(index + 1).padStart(2, "0")}`, kind: "single", prompt: add ? `${person} has ${start} ${item} and gets ${change} more. How many ${item} does ${person} have now? Reply with only the number.` : `${person} has ${start} ${item} and gives away ${change}. How many ${item} remain? Reply with only the number.`, expected: String(add ? start + change : start - change), metadata: { operation: add ? "addition" : "subtraction", generatorSeed: seed } };
});
tasks.push({ id: "order-lookup-01", kind: "episode", prompt: "Look up order ORD-104. Retry one transient failure, then refund the wrong item only when it is within the $50 policy limit.", metadata: { orderId: "ORD-104", policyLimitUsd: 50, seed: 1 } });
await mkdir(new URL("../data/", import.meta.url), { recursive: true });
await writeFile(new URL("../data/tasks.jsonl", import.meta.url), `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
console.log(`generated 20 arithmetic tasks and 1 episode task with seed ${seed}`);
