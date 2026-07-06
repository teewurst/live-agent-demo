import type { Request } from "express";
import type { SessionState, ToolBackendMode } from "./types.js";
import { refreshMcpTools } from "./mcpToolRegistry.js";
import { setToolBackendMode } from "./sessions.js";

const HEADER_NAME = "x-tool-backend";

export function parseToolBackendMode(value: string | undefined): ToolBackendMode | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "local" || normalized === "mcp") {
    return normalized;
  }
  return null;
}

export function applyToolBackendFromRequest(req: Request, session: SessionState): ToolBackendMode {
  const previousMode = session.toolBackendMode;
  const fromHeader = parseToolBackendMode(req.header(HEADER_NAME));
  if (fromHeader) {
    setToolBackendMode(session, fromHeader);
    if (fromHeader !== previousMode) {
      void refreshMcpTools(session, fromHeader);
    }
    return fromHeader;
  }

  const bodyMode =
    req.body && typeof req.body === "object"
      ? parseToolBackendMode(String((req.body as { toolBackend?: string }).toolBackend ?? ""))
      : null;
  if (bodyMode) {
    setToolBackendMode(session, bodyMode);
    if (bodyMode !== previousMode) {
      void refreshMcpTools(session, bodyMode);
    }
    return bodyMode;
  }

  return session.toolBackendMode;
}

export const TOOL_BACKEND_HEADER = "X-Tool-Backend";
