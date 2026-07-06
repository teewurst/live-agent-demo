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
const PLAYBACK_BARGE_IN_MS = 800;
const MS_PER_VAD_FRAME = 32;
const BARGE_IN_FRAME_STREAK = Math.ceil(PLAYBACK_BARGE_IN_MS / MS_PER_VAD_FRAME);
const PLAYBACK_VAD_THRESHOLD = 0.5;
const PLAYBACK_RMS_BASELINE_EMA = 0.92;
const PLAYBACK_RMS_SPIKE_MULT = 2.2;
const PLAYBACK_RMS_MIN_SPIKE = 0.035;

function frameRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}

export class UtteranceRecorder {
  private micVad: MicVAD | null = null;
  private micStream: MediaStream | null = null;
  private playbackActive = false;
  private discardNextSpeechEnd = false;
  private bargeInArmed = false;
  private bargeInFrameStreak = 0;
  private playbackMicBaseline = 0.01;
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
          this.bargeInFrameStreak = 0;
          this.speaking = false;
        },
        onFrameProcessed: (probs, frame) => {
          this.lastSpeechLevel = probs.isSpeech;
          this.callbacks.onLevel?.(probs.isSpeech);
          this.trackPlaybackBargeIn(probs.isSpeech, frame);
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
    this.bargeInFrameStreak = 0;
  }

  getLevel(): number {
    return this.lastSpeechLevel;
  }

  setPlaybackActive(active: boolean): void {
    this.playbackActive = active;
    if (active) {
      this.resetPlaybackBargeInState();
    }
  }

  private resetPlaybackBargeInState(): void {
    this.bargeInArmed = false;
    this.bargeInFrameStreak = 0;
    this.playbackMicBaseline = 0.01;
  }

  /**
   * During agent playback, ignore Silero-only triggers (agent echo) and require a
   * sustained mic-energy spike above the rolling baseline (user talking over Helen).
   */
  private trackPlaybackBargeIn(isSpeech: number, frame: Float32Array): void {
    if (!this.playbackActive || this.bargeInArmed) {
      return;
    }

    const micRms = frameRms(frame);

    if (isSpeech < 0.3) {
      this.playbackMicBaseline =
        this.playbackMicBaseline * PLAYBACK_RMS_BASELINE_EMA +
        micRms * (1 - PLAYBACK_RMS_BASELINE_EMA);
    }

    const spikeThreshold = Math.max(
      this.playbackMicBaseline * PLAYBACK_RMS_SPIKE_MULT,
      PLAYBACK_RMS_MIN_SPIKE,
    );
    const userLikelySpeaking = isSpeech >= PLAYBACK_VAD_THRESHOLD && micRms >= spikeThreshold;

    if (userLikelySpeaking) {
      this.bargeInFrameStreak += 1;
    } else {
      this.bargeInFrameStreak = 0;
    }

    if (this.bargeInFrameStreak < BARGE_IN_FRAME_STREAK) {
      return;
    }

    this.bargeInFrameStreak = 0;
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
      return;
    }

    this.bargeInArmed = false;

    const wavBuffer = utils.encodeWAV(audio);
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    this.callbacks.onSpeechEnd?.(blob);
  }
}
