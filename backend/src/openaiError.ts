export type ParsedOpenAiError = {
  message: string;
  code?: string;
  type?: string;
};

export function parseOpenAiErrorBody(raw: string): ParsedOpenAiError | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const payload = JSON.parse(trimmed) as {
      error?: { message?: string; code?: string; type?: string };
    };
    if (payload.error?.message) {
      return {
        message: payload.error.message,
        code: payload.error.code,
        type: payload.error.type,
      };
    }
  } catch {
    // Fall through to plain-text handling.
  }

  return { message: trimmed };
}

export function formatOpenAiError(prefix: string, raw: string): string {
  const parsed = parseOpenAiErrorBody(raw);
  if (!parsed) {
    return prefix;
  }
  const codeSuffix = parsed.code ? ` (${parsed.code})` : "";
  return `${prefix}: ${parsed.message}${codeSuffix}`;
}
