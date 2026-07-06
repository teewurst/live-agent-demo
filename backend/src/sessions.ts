import { v4 as uuidv4 } from "uuid";
import { AppError } from "./errors.js";
import type { ChatMessage, ChatRole, SessionState, TimelineItem, TimelineItemKind, ToolBackendMode } from "./types.js";
import { teardownMcpSession } from "./mcpToolRegistry.js";

const sessions = new Map<string, SessionState>();

function nowIso(): string {
  return new Date().toISOString();
}

function createEmptySession(): SessionState {
  const now = nowIso();
  return {
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
    turnCounter: 0,
    history: [],
    timeline: [],
    interrupted: false,
    greetingPlayed: false,
    customerValidated: false,
    toolBackendMode: "local",
  };
}

export function createSession(): SessionState {
  const session = createEmptySession();
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): SessionState {
  const session = sessions.get(id);
  if (!session) {
    throw new AppError("Session not found", "SESSION_NOT_FOUND", 404);
  }
  return session;
}

export function resetSession(oldId: string): SessionState {
  const oldSession = getSession(oldId);
  if (oldSession.currentAbortController) {
    oldSession.currentAbortController.abort();
  }
  void teardownMcpSession(oldId);
  sessions.delete(oldId);
  return createSession();
}

export function interruptSession(id: string): SessionState {
  const session = getSession(id);
  session.interrupted = true;
  if (session.currentAbortController) {
    session.currentAbortController.abort();
    session.currentAbortController = undefined;
  }
  session.updatedAt = nowIso();
  return session;
}

export function setAbortController(session: SessionState, controller: AbortController): void {
  if (session.currentAbortController) {
    session.currentAbortController.abort();
  }
  session.interrupted = false;
  session.currentAbortController = controller;
  session.updatedAt = nowIso();
}

export function clearAbortController(session: SessionState, signal?: AbortSignal): void {
  if (signal && session.currentAbortController?.signal !== signal) {
    return;
  }
  session.currentAbortController = undefined;
  session.updatedAt = nowIso();
}

export function incrementTurn(session: SessionState): number {
  session.turnCounter += 1;
  session.updatedAt = nowIso();
  return session.turnCounter;
}

export function addMessage(
  session: SessionState,
  role: ChatRole,
  content: string,
  toolCallId?: string,
  toolName?: string,
): ChatMessage {
  const message: ChatMessage = {
    role,
    content,
    createdAt: nowIso(),
    toolCallId,
    toolName,
  };
  session.history.push(message);
  session.updatedAt = nowIso();
  return message;
}

type TimelineInput = {
  kind: TimelineItemKind;
  text: string;
  toolCallId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status?: TimelineItem["status"];
  live?: boolean;
};

export function addTimelineItem(session: SessionState, input: TimelineInput): string {
  const item: TimelineItem = {
    id: uuidv4(),
    kind: input.kind,
    text: input.text,
    createdAt: nowIso(),
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    arguments: input.arguments,
    result: input.result,
    status: input.status,
    live: input.live,
  };
  session.timeline.push(item);
  session.updatedAt = nowIso();
  return item.id;
}

export function updateTimelineItem(
  session: SessionState,
  itemId: string,
  patch: Partial<TimelineItem>,
): void {
  const item = session.timeline.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }
  Object.assign(item, patch);
  session.updatedAt = nowIso();
}

export function setCustomerValidation(
  session: SessionState,
  customerNumber: string | undefined,
  validated: boolean,
): void {
  session.customerValidated = validated;
  session.customerNumber = validated ? customerNumber : undefined;
  session.updatedAt = nowIso();
}

export function setToolBackendMode(session: SessionState, mode: ToolBackendMode): void {
  session.toolBackendMode = mode;
  session.updatedAt = nowIso();
}
