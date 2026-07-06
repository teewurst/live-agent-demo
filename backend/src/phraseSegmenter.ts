import { config } from "./config.js";

export class PhraseSegmenter {
  private buffer = "";

  constructor(
    private readonly maxChars = config.PHRASE_MAX_CHARS,
    private readonly minChars = config.PHRASE_MIN_CHARS,
    private readonly flushOnNewline = config.PHRASE_FLUSH_ON_NEWLINE,
  ) {}

  feed(chunk: string): string[] {
    this.buffer += chunk;
    const phrases: string[] = [];

    while (true) {
      const flushIndex = this.findFlushIndex();
      if (flushIndex === -1) {
        if (this.buffer.length > this.maxChars) {
          const forced = this.buffer.slice(0, this.maxChars).trim();
          this.buffer = this.buffer.slice(this.maxChars);
          if (forced.length >= this.minChars) {
            phrases.push(forced);
          }
          continue;
        }
        break;
      }

      const candidate = this.buffer.slice(0, flushIndex + 1).trim();
      this.buffer = this.buffer.slice(flushIndex + 1);

      if (candidate.length >= this.minChars) {
        phrases.push(candidate);
      } else if (candidate.length > 0) {
        this.buffer = candidate + this.buffer;
        break;
      }
    }

    return phrases;
  }

  flushRemaining(force = false): string | null {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (!remaining) {
      return null;
    }
    if (force || remaining.length >= this.minChars) {
      return remaining;
    }
    return remaining.length > 0 ? remaining : null;
  }

  private findFlushIndex(): number {
    for (let i = 0; i < this.buffer.length; i += 1) {
      const char = this.buffer[i];
      if (char === "." || char === "?" || char === "!") {
        return i;
      }
      if (this.flushOnNewline && char === "\n") {
        return i;
      }
      if (char === ";" && this.buffer.slice(0, i + 1).trim().length >= this.minChars) {
        return i;
      }
    }
    return -1;
  }
}
