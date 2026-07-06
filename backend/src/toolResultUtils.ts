export function summarizeToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result.slice(0, 500);
  }
  try {
    return JSON.stringify(result).slice(0, 500);
  } catch {
    return String(result);
  }
}
