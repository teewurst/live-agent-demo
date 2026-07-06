export type TurnProfileBucketKey = "transcribing" | "agent" | "tools" | "tts";

export type TurnProfileSpanKind =
  | "network"
  | "transcribing"
  | "agent_llm"
  | "tool"
  | "tts";

export type TurnProfileBucket = {
  key: TurnProfileBucketKey;
  label: string;
  ms: number;
};

export type TurnProfileSpan = {
  id: string;
  kind: TurnProfileSpanKind;
  label: string;
  ms: number;
  detail?: string;
};

export type TurnProfile = {
  turnId: number;
  totalMs: number;
  buckets: TurnProfileBucket[];
  spans: TurnProfileSpan[];
};

export type ClientTurnTiming = {
  uploadMs: number;
  connectMs: number;
  audioBytes: number;
};

const BUCKET_LABELS: Record<TurnProfileBucketKey, string> = {
  transcribing: "Middleware",
  agent: "AI Agent (LLM)",
  tools: "MCP / Tools",
  tts: "TTS",
};

function spanKindToBucket(kind: TurnProfileSpanKind): TurnProfileBucketKey {
  switch (kind) {
    case "network":
    case "transcribing":
      return "transcribing";
    case "agent_llm":
      return "agent";
    case "tool":
      return "tools";
    case "tts":
      return "tts";
  }
}

function buildBuckets(spans: TurnProfileSpan[]): TurnProfileBucket[] {
  const sums: Record<TurnProfileBucketKey, number> = {
    transcribing: 0,
    agent: 0,
    tools: 0,
    tts: 0,
  };

  for (const span of spans) {
    sums[spanKindToBucket(span.kind)] += span.ms;
  }

  return (Object.keys(sums) as TurnProfileBucketKey[])
    .filter((key) => sums[key] > 0)
    .map((key) => ({
      key,
      label: BUCKET_LABELS[key],
      ms: sums[key],
    }));
}

export function mergeClientTurnTiming(
  profile: TurnProfile,
  client?: ClientTurnTiming | null,
): TurnProfile {
  if (!client) {
    return profile;
  }

  const audioKb = Math.max(1, Math.round(client.audioBytes / 1024));
  const networkSpans: TurnProfileSpan[] = [];

  if (client.connectMs > 0) {
    networkSpans.push({
      id: "client-connect",
      kind: "network",
      label: "Network connection",
      ms: client.connectMs,
      detail: "TCP/TLS handshake",
    });
  }

  networkSpans.push({
    id: "client-upload",
    kind: "network",
    label: "Network upload",
    ms: Math.max(client.uploadMs, 0),
    detail:
      client.connectMs > 0
        ? `${audioKb} KB audio → backend`
        : `${audioKb} KB · pooled connection`,
  });

  const networkMs = networkSpans.reduce((sum, span) => sum + span.ms, 0);
  const spans: TurnProfileSpan[] = [...networkSpans, ...profile.spans];

  return {
    ...profile,
    totalMs: profile.totalMs + networkMs,
    spans,
    buckets: buildBuckets(spans),
  };
}

export function formatProfileMs(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}

export function spanShareOfBucket(spanMs: number, bucketMs: number): number {
  if (bucketMs <= 0) {
    return 0;
  }
  return Math.round((spanMs / bucketMs) * 100);
}
