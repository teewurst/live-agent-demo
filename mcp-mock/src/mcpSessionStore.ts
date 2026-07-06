export type CrmMcpSessionState = {
  customerValidated: boolean;
  customerNumber?: string;
};

const sessions = new Map<string, CrmMcpSessionState>();

export function getCrmSession(sessionId: string | undefined): CrmMcpSessionState {
  if (!sessionId) {
    return { customerValidated: false };
  }
  return sessions.get(sessionId) ?? { customerValidated: false };
}

export function setCrmSessionValidation(
  sessionId: string | undefined,
  customerNumber: string | undefined,
  validated: boolean,
): void {
  if (!sessionId) {
    return;
  }
  if (!validated) {
    sessions.delete(sessionId);
    return;
  }
  sessions.set(sessionId, {
    customerValidated: true,
    customerNumber,
  });
}

export function clearCrmSession(sessionId: string): void {
  sessions.delete(sessionId);
}
