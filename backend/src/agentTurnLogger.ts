import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type AgentLogEvent = {
  ts: string;
  sessionId: string;
  turnId: number;
  type: string;
  [key: string]: unknown;
};

function formatTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export class AgentTurnLogger {
  private readonly filePath: string;
  private closed = false;

  constructor(
    private readonly sessionId: string,
    private readonly turnId: number,
  ) {
    const dir = path.resolve(config.AGENT_LOG_DIR);
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(
      dir,
      `${formatTimestamp()}_${sessionId.slice(0, 8)}_turn${turnId}.jsonl`,
    );
  }

  get logFilePath(): string {
    return this.filePath;
  }

  log(type: string, payload: Record<string, unknown> = {}): void {
    if (!config.AGENT_LOG_ENABLED || this.closed) {
      return;
    }

    const event: AgentLogEvent = {
      ts: new Date().toISOString(),
      sessionId: this.sessionId,
      turnId: this.turnId,
      type,
      ...payload,
    };

    try {
      fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    } catch (error) {
      console.error("[agentTurnLogger] failed to write log:", error);
    }
  }

  close(summary: Record<string, unknown> = {}): void {
    if (this.closed) {
      return;
    }
    this.log("turn_end", summary);
    this.closed = true;
  }
}
