import type { Environment, JsonValue, Task, ToolResult } from "../../src/types.js";
interface OrderState { lookupAttempts: number; orderLoaded: boolean; refunded: boolean; faultInjected: boolean; }
export class OrderLookupEnvironment implements Environment<Task> {
  #state: OrderState = { lookupAttempts: 0, orderLoaded: false, refunded: false, faultInjected: false };
  #faultOnFirst = true;
  reset(_task: Task, seed: number) {
    this.#state = { lookupAttempts: 0, orderLoaded: false, refunded: false, faultInjected: false }; this.#faultOnFirst = (seed & 1) === 1;
    return { system: "Use the order tools. Retry transient errors. Refund only orders at or below the $50 policy limit.", tools: [
      { name: "lookup_order", description: "Look up an order by id.", parameters: { type: "object" as const, properties: { orderId: { type: "string" } }, required: ["orderId"], additionalProperties: false } },
      { name: "refund_order", description: "Refund a loaded order under the policy limit.", parameters: { type: "object" as const, properties: { orderId: { type: "string" }, reason: { type: "string" } }, required: ["orderId", "reason"], additionalProperties: false } },
    ] };
  }
  callTool(name: string, args: Record<string, JsonValue>): ToolResult {
    if (name === "lookup_order") {
      this.#state.lookupAttempts++;
      if (args.orderId !== "ORD-104") return { result: null, error: { code: "NOT_FOUND", message: "Order not found." } };
      if (this.#faultOnFirst && this.#state.lookupAttempts === 1) { this.#state.faultInjected = true; return { result: null, error: { code: "HTTP_500", message: "Temporary order service failure." } }; }
      this.#state.orderLoaded = true; return { result: { orderId: "ORD-104", totalUsd: 35, status: "wrong_item" } };
    }
    if (name === "refund_order") {
      if (!this.#state.orderLoaded) return { result: null, error: { code: "LOOKUP_REQUIRED", message: "Look up the order before refunding." } };
      if (args.orderId !== "ORD-104") return { result: null, error: { code: "NOT_FOUND", message: "Order not found." } };
      this.#state.refunded = true; return { result: { refunded: true, amountUsd: 35 } };
    }
    return { result: null, error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}` } };
  }
  state(): unknown { return { ...this.#state }; }
  done(): boolean { return this.#state.refunded; }
}
