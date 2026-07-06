import type { TimelineItem } from "../types/orchestration";

const MAX_LINE = 96;

function truncate(value: string, max = MAX_LINE): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

function compactJson(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return truncate(value, 72);
  }
  try {
    return truncate(JSON.stringify(value), 72);
  } catch {
    return truncate(String(value), 72);
  }
}

function summarizeToolResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return compactJson(result);
  }
  const record = result as Record<string, unknown>;
  if (typeof record.valid === "boolean") {
    return `valid: ${record.valid}`;
  }
  if (typeof record.error === "string") {
    return String(record.error);
  }
  if (record.invoice && typeof record.invoice === "object") {
    const invoice = record.invoice as Record<string, unknown>;
    return `invoice: ${String(invoice.invoiceId ?? "—")}`;
  }
  if (typeof record.resultCount === "number") {
    return `${record.resultCount} result(s)`;
  }
  if (record.lookup) {
    return `lookup: ${String(record.lookup)}`;
  }
  return compactJson(result);
}

export function summarizeTimelineLine(item: TimelineItem): string {
  switch (item.kind) {
    case "user":
    case "assistant":
    case "agent_trace":
    case "error":
      return truncate(item.text);
    case "tool_call":
      return `${item.toolName ?? "tool"} ${compactJson(item.arguments)}`.trim();
    case "tool_result": {
      const status = item.status === "error" ? "error" : "ok";
      return `${item.toolName ?? "tool"} [${status}] ${summarizeToolResult(item.result)}`.trim();
    }
    default:
      return truncate(item.text);
  }
}

export function formatJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
