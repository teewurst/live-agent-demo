type PlaybackCallbacks = {
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
  onQueueEmpty?: () => void;
  onPlaybackError?: (error: unknown) => void;
};

type QueueItem = {
  sequence: number;
  url: string;
};

export class PlaybackQueue {
  private queue: QueueItem[] = [];
  private currentAudio: HTMLAudioElement | null = null;
  private playing = false;
  private generation = 0;
  private finishCurrent: (() => void) | null = null;
  private audioContext: AudioContext | null = null;

  constructor(private readonly callbacks: PlaybackCallbacks = {}) {}

  enqueue(base64: string, mimeType: string, sequence: number): void {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    this.queue.push({ sequence, url });
    this.queue.sort((a, b) => a.sequence - b.sequence);

    if (!this.playing) {
      void this.playNext();
    }
  }

  clear(): void {
    const hadActivity = this.isActive();
    this.generation += 1;
    this.queue.forEach((item) => URL.revokeObjectURL(item.url));
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    this.finishCurrent?.();
    this.finishCurrent = null;
    this.playing = false;
    if (hadActivity) {
      this.callbacks.onQueueEmpty?.();
    }
  }

  isActive(): boolean {
    return this.playing || this.queue.length > 0 || this.currentAudio !== null;
  }

  waitUntilIdle(): Promise<void> {
    if (!this.isActive()) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const check = () => {
        if (!this.isActive()) {
          resolve();
        } else {
          window.setTimeout(check, 50);
        }
      };
      check();
    });
  }

  private async playNext(): Promise<void> {
    const gen = this.generation;
    const next = this.queue.shift();
    if (!next) {
      this.playing = false;
      if (gen === this.generation) {
        this.callbacks.onQueueEmpty?.();
      }
      return;
    }

    this.playing = true;
    this.callbacks.onPlaybackStart?.();

    await new Promise<void>((resolve) => {
      const audio = new Audio(next.url);
      this.currentAudio = audio;
      this.routeThroughAudioContext(audio);

      const finish = () => {
        URL.revokeObjectURL(next.url);
        if (this.currentAudio === audio) {
          this.currentAudio = null;
        }
        if (this.finishCurrent === finish) {
          this.finishCurrent = null;
        }
        this.callbacks.onPlaybackEnd?.();
        resolve();
      };

      this.finishCurrent = finish;

      audio.onended = finish;
      audio.onerror = () => {
        this.callbacks.onPlaybackError?.(new Error("Audio playback failed"));
        finish();
      };
      void audio.play().catch((error) => {
        this.callbacks.onPlaybackError?.(error);
        finish();
      });
    });

    if (gen !== this.generation) {
      return;
    }

    await this.playNext();
  }

  /** Route TTS through Web Audio so browser AEC can use it as echo reference. */
  private routeThroughAudioContext(audio: HTMLAudioElement): void {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    const source = this.audioContext.createMediaElementSource(audio);
    source.connect(this.audioContext.destination);
    void this.audioContext.resume();
  }
}
