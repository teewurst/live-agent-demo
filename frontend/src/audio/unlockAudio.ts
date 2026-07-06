let unlocked = false;

// Minimal silent WAV — must play synchronously inside the click handler.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";

export function unlockAudioPlayback(): void {
  if (unlocked) {
    return;
  }

  const audio = new Audio(SILENT_WAV);
  audio.volume = 0.00001;
  void audio
    .play()
    .then(() => {
      unlocked = true;
      audio.pause();
      audio.removeAttribute("src");
    })
    .catch(() => {
      // If this fails, later TTS playback will likely fail too.
    });
}
