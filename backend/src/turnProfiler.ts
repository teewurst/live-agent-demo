export type ProfileSpanKind =
  | "network"
  | "transcribing"
  | "agent_llm"
  | "tool"
  | "tts";

export type ProfileSpan = {
  id: string;
  kind: ProfileSpanKind;
  label: string;
  ms: number;
  detail?: string;
};

export type TurnProfileBucket = {
  key: "transcribing" | "agent" | "tools" | "tts";
  label: string;
  ms: number;
};

export type TurnProfile = {
  turnId: number;
  totalMs: number;
  buckets: TurnProfileBucket[];
  spans: ProfileSpan[];
  firstResponse: {
    /** Server: turn start → first assistant caption SSE */
    captionMs: number | null;
    /** Server: turn start → first audio segment ready (TTS done) */
    audioMs: number | null;
    captionPreview?: string;
  };
};

const BUCKET_LABELS: Record<TurnProfileBucket["key"], string> = {
  transcribing: "Middleware",
  agent: "AI Agent (LLM)",
  tools: "MCP / Tools",
  tts: "TTS",
};

function spanKindToBucket(kind: ProfileSpanKind): TurnProfileBucket["key"] {
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

function buildBuckets(spans: ProfileSpan[]): TurnProfileBucket[] {
  const sums: Record<TurnProfileBucket["key"], number> = {
    transcribing: 0,
    agent: 0,
    tools: 0,
    tts: 0,
  };

  for (const span of spans) {
    sums[spanKindToBucket(span.kind)] += span.ms;
  }

  return (Object.keys(sums) as TurnProfileBucket["key"][])
    .filter((key) => sums[key] > 0)
    .map((key) => ({
      key,
      label: BUCKET_LABELS[key],
      ms: sums[key],
    }));
}

export class TurnProfiler {
  private readonly startedAt = performance.now();
  private readonly spans: ProfileSpan[] = [];
  private readonly activeSpans = new Map<string, { kind: ProfileSpanKind; label: string; detail?: string; startedAt: number }>();
  private firstCaptionMs: number | null = null;
  private firstCaptionPreview = "";
  private firstAudioMs: number | null = null;

  markFirstCaption(preview: string): void {
    if (this.firstCaptionMs !== null) {
      return;
    }
    this.firstCaptionMs = Math.max(0, Math.round(performance.now() - this.startedAt));
    this.firstCaptionPreview = preview.trim().slice(0, 120);
  }

  markFirstAudio(): void {
    if (this.firstAudioMs !== null) {
      return;
    }
    this.firstAudioMs = Math.max(0, Math.round(performance.now() - this.startedAt));
  }

  startSpan(
    id: string,
    kind: ProfileSpanKind,
    label: string,
    detail?: string,
  ): void {
    this.activeSpans.set(id, {
      kind,
      label,
      detail,
      startedAt: performance.now(),
    });
  }

  endSpan(id: string, detail?: string): number {
    const active = this.activeSpans.get(id);
    if (!active) {
      return 0;
    }

    const ms = Math.max(0, Math.round(performance.now() - active.startedAt));
    this.activeSpans.delete(id);
    this.spans.push({
      id,
      kind: active.kind,
      label: active.label,
      ms,
      detail: detail ?? active.detail,
    });
    return ms;
  }

  addSpan(
    kind: ProfileSpanKind,
    label: string,
    ms: number,
    detail?: string,
    id?: string,
  ): void {
    this.spans.push({
      id: id ?? `${kind}-${this.spans.length}`,
      kind,
      label,
      ms: Math.max(0, Math.round(ms)),
      detail,
    });
  }

  finish(turnId: number): TurnProfile {
    for (const [id, active] of [...this.activeSpans.entries()]) {
      this.endSpan(id, active.detail);
    }

    const totalMs = Math.max(0, Math.round(performance.now() - this.startedAt));
    const spans = [...this.spans];

    return {
      turnId,
      totalMs,
      buckets: buildBuckets(spans),
      spans,
      firstResponse: {
        captionMs: this.firstCaptionMs,
        audioMs: this.firstAudioMs,
        captionPreview: this.firstCaptionPreview || undefined,
      },
    };
  }
}
