import { MicVAD, utils } from "@ricky0123/vad-web";

export type RecorderCallbacks = {
  onSpeechStart?: () => void;
  onSpeechEnd?: (blob: Blob) => void;
  onLevel?: (rms: number) => void;
  onError?: (message: string) => void;
};

const VAD_ASSET_PATH = "/vad/";
const MIN_SPEECH_MS_IDLE = 300;
const VAD_REDEMPTION_MS = 1600;
const VAD_PRE_SPEECH_PAD_MS = 450;

/** Sustained speech required to interrupt agent playback. */
const PLAYBACK_BARGE_IN_MS = 2000;
/** Brief pauses inside one utterance do not reset the timer. */
const PLAYBACK_BARGE_GAP_MS = 450;
const MS_PER_VAD_FRAME = 32;
const PLAYBACK_SPEECH_THRESHOLD = 0.38;

export class UtteranceRecorder {
  private micVad: MicVAD | null = null;
  private micStream: MediaStream | null = null;
  private playbackActive = false;
  private discardNextSpeechEnd = false;
  private bargeInArmed = false;
  private bargeInSpeechMs = 0;
  private bargeInLastSpeechAt = 0;
  private lastSpeechLevel = 0;
  private speaking = false;
  private pendingSpeechEnd: Float32Array | null = null;

  constructor(private readonly callbacks: RecorderCallbacks = {}) {}

  /** Request mic permission while the user-gesture is still active. */
  async acquireMicrophone(): Promise<void> {
    if (this.micStream) {
      return;
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  }

  async startListening(): Promise<boolean> {
    if (this.micVad) {
      return true;
    }

    try {
      if (!this.micStream) {
        await this.acquireMicrophone();
      }

      this.micVad = await MicVAD.new({
        baseAssetPath: VAD_ASSET_PATH,
        onnxWASMBasePath: VAD_ASSET_PATH,
        model: "v5",
        startOnLoad: false,
        minSpeechMs: MIN_SPEECH_MS_IDLE,
        redemptionMs: VAD_REDEMPTION_MS,
        preSpeechPadMs: VAD_PRE_SPEECH_PAD_MS,
        positiveSpeechThreshold: 0.35,
        negativeSpeechThreshold: 0.25,
        ortConfig: (ort) => {
          ort.env.logLevel = "error";
          ort.env.wasm.numThreads = 1;
        },
        getStream: async () => {
          if (!this.micStream) {
            await this.acquireMicrophone();
          }
          return this.micStream!;
        },
        pauseStream: async (stream) => {
          stream.getTracks().forEach((track) => track.stop());
          this.micStream = null;
        },
        resumeStream: async () => {
          await this.acquireMicrophone();
          return this.micStream!;
        },
        onSpeechStart: () => {
          if (this.playbackActive) {
            return;
          }
          this.speaking = true;
          this.callbacks.onSpeechStart?.();
        },
        onSpeechEnd: (audio) => {
          this.handleSpeechEnd(audio);
        },
        onVADMisfire: () => {
          if (!this.playbackActive || this.bargeInArmed) {
            return;
          }
          this.resetBargeInTimer();
          this.speaking = false;
        },
        onFrameProcessed: (probs) => {
          this.lastSpeechLevel = probs.isSpeech;
          this.callbacks.onLevel?.(probs.isSpeech);
          this.trackPlaybackBargeIn(probs.isSpeech);
        },
      });

      await this.micVad.start();
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = /permission|notallowed|denied/i.test(detail)
        ? "Microphone permission denied"
        : `Voice detection failed: ${detail}`;
      console.error("MicVAD setup failed:", error);
      this.callbacks.onError?.(message);
      this.micVad = null;
      return false;
    }
  }

  stop(): void {
    void this.micVad?.pause();
    this.micVad?.destroy();
    this.micVad = null;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.speaking = false;
    this.resetPlaybackBargeInState();
  }

  isListening(): boolean {
    return this.micVad !== null;
  }

  isRecording(): boolean {
    return this.speaking;
  }

  cancelActiveRecording(): void {
    this.discardNextSpeechEnd = true;
    this.speaking = false;
    this.bargeInArmed = false;
    this.resetBargeInTimer();
  }

  getLevel(): number {
    return this.lastSpeechLevel;
  }

  resetCaptureState(): void {
    this.pendingSpeechEnd = null;
    this.discardNextSpeechEnd = false;
    this.bargeInArmed = false;
    this.resetBargeInTimer();
    this.speaking = false;
  }

  setPlaybackActive(active: boolean): void {
    const wasActive = this.playbackActive;
    this.playbackActive = active;
    if (active) {
      if (!wasActive) {
        this.pendingSpeechEnd = null;
        this.resetPlaybackBargeInState();
      }
      return;
    }
    if (wasActive) {
      this.flushPendingSpeechEnd();
    }
  }

  private flushPendingSpeechEnd(): void {
    if (!this.pendingSpeechEnd) {
      return;
    }
    const audio = this.pendingSpeechEnd;
    this.pendingSpeechEnd = null;
    this.bargeInArmed = false;
    const wavBuffer = utils.encodeWAV(audio);
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    this.callbacks.onSpeechEnd?.(blob);
  }

  private resetBargeInTimer(): void {
    this.bargeInSpeechMs = 0;
    this.bargeInLastSpeechAt = 0;
  }

  private resetPlaybackBargeInState(): void {
    this.bargeInArmed = false;
    this.resetBargeInTimer();
  }

  /**
   * During agent playback, require ~2s of sustained VAD speech before interrupt.
   * Short blips ("Ja", clicks) reset via the gap window and do not interrupt.
   */
  private trackPlaybackBargeIn(isSpeech: number): void {
    if (!this.playbackActive || this.bargeInArmed) {
      return;
    }

    const now = Date.now();
    const speechLike = isSpeech >= PLAYBACK_SPEECH_THRESHOLD;

    if (speechLike) {
      const gap = this.bargeInLastSpeechAt > 0 ? now - this.bargeInLastSpeechAt : 0;
      if (this.bargeInSpeechMs > 0 && gap > PLAYBACK_BARGE_GAP_MS) {
        this.bargeInSpeechMs = MS_PER_VAD_FRAME;
      } else {
        this.bargeInSpeechMs += MS_PER_VAD_FRAME;
      }
      this.bargeInLastSpeechAt = now;
    } else if (this.bargeInSpeechMs > 0 && now - this.bargeInLastSpeechAt > PLAYBACK_BARGE_GAP_MS) {
      this.resetBargeInTimer();
    }

    if (this.bargeInSpeechMs < PLAYBACK_BARGE_IN_MS) {
      return;
    }

    this.resetBargeInTimer();
    this.bargeInArmed = true;
    this.speaking = true;
    this.callbacks.onSpeechStart?.();
  }

  private handleSpeechEnd(audio: Float32Array): void {
    this.speaking = false;

    if (this.discardNextSpeechEnd) {
      this.discardNextSpeechEnd = false;
      this.bargeInArmed = false;
      return;
    }

    if (this.playbackActive && !this.bargeInArmed) {
      this.resetBargeInTimer();
      return;
    }

    this.bargeInArmed = false;

    const wavBuffer = utils.encodeWAV(audio);
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    this.callbacks.onSpeechEnd?.(blob);
  }
}
