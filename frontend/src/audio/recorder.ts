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

/** Sustained speech segment required to interrupt agent playback. */
const PLAYBACK_BARGE_IN_MS = 1300;

export class UtteranceRecorder {
  private micVad: MicVAD | null = null;
  private micStream: MediaStream | null = null;
  private playbackActive = false;
  private discardNextSpeechEnd = false;
  private bargeInArmed = false;
  private overPlaybackSpeechOpen = false;
  private playbackBargeTimer: ReturnType<typeof window.setTimeout> | null = null;
  private lastSpeechLevel = 0;
  private speaking = false;

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
            this.overPlaybackSpeechOpen = true;
            this.schedulePlaybackBargeIn();
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
          this.clearPlaybackBargeTimer();
          this.overPlaybackSpeechOpen = false;
          this.speaking = false;
        },
        onFrameProcessed: (probs) => {
          this.lastSpeechLevel = probs.isSpeech;
          this.callbacks.onLevel?.(probs.isSpeech);
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
    this.overPlaybackSpeechOpen = false;
    this.clearPlaybackBargeTimer();
  }

  getLevel(): number {
    return this.lastSpeechLevel;
  }

  resetCaptureState(): void {
    this.discardNextSpeechEnd = false;
    this.resetPlaybackBargeInState();
    this.speaking = false;
  }

  setPlaybackActive(active: boolean): void {
    const wasActive = this.playbackActive;
    this.playbackActive = active;
    if (active) {
      if (!wasActive) {
        this.resetPlaybackBargeInState();
      }
      return;
    }
    // Playback ended — never auto-submit buffered playback-era speech here.
    this.clearPlaybackBargeTimer();
  }

  private schedulePlaybackBargeIn(): void {
    if (this.bargeInArmed || this.playbackBargeTimer !== null) {
      return;
    }

    this.playbackBargeTimer = window.setTimeout(() => {
      this.playbackBargeTimer = null;
      if (!this.playbackActive || this.bargeInArmed) {
        return;
      }
      this.armBargeIn();
    }, PLAYBACK_BARGE_IN_MS);
  }

  private clearPlaybackBargeTimer(): void {
    if (this.playbackBargeTimer !== null) {
      window.clearTimeout(this.playbackBargeTimer);
      this.playbackBargeTimer = null;
    }
  }

  private armBargeIn(): void {
    this.clearPlaybackBargeTimer();
    this.bargeInArmed = true;
    this.speaking = true;
    this.overPlaybackSpeechOpen = false;
    this.callbacks.onSpeechStart?.();
  }

  private resetPlaybackBargeInState(): void {
    this.bargeInArmed = false;
    this.overPlaybackSpeechOpen = false;
    this.clearPlaybackBargeTimer();
  }

  private handleSpeechEnd(audio: Float32Array): void {
    this.speaking = false;
    this.clearPlaybackBargeTimer();

    if (this.discardNextSpeechEnd) {
      this.discardNextSpeechEnd = false;
      this.bargeInArmed = false;
      this.overPlaybackSpeechOpen = false;
      return;
    }

    const startedDuringPlayback = this.overPlaybackSpeechOpen;
    this.overPlaybackSpeechOpen = false;

    if (!this.bargeInArmed && (this.playbackActive || startedDuringPlayback)) {
      return;
    }

    this.bargeInArmed = false;

    const wavBuffer = utils.encodeWAV(audio);
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    this.callbacks.onSpeechEnd?.(blob);
  }
}
