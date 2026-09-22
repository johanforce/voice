class VoicePreviewEngine {
  private currentAudio: HTMLAudioElement | null = null;
  private currentPlayingId: string | null = null;
  private onEndedCallback: (() => void) | null = null;

  public stopAll(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio.src = '';
      } catch {
        // ignore
      }
      this.currentAudio = null;
    }
    if (this.onEndedCallback) {
      this.onEndedCallback();
      this.onEndedCallback = null;
    }
    this.currentPlayingId = null;
  }

  public getCurrentPlayingId(): string | null {
    return this.currentPlayingId;
  }

  /**
   * Phát trực tiếp file âm thanh thật sinh ra từ VieNeu SDK (URL hoặc base64).
   * Tuyệt đối không sử dụng bất kỳ giọng đọc mặc định/backup nào của Windows hay trình duyệt.
   */
  public async playRealAudio(
      voiceId: string,
      audioSrc: string,
      onPlayStateChange?: (isPlaying: boolean) => void,
      onWaveformUpdate?: (frequencies: number[]) => void
  ): Promise<void> {
    this.stopAll();

    this.currentPlayingId = voiceId;
    if (onPlayStateChange) onPlayStateChange(true);

    const audio = new Audio();
    this.currentAudio = audio;

    let animFrame: number;
    let isEnded = false;

    const cleanup = () => {
      if (isEnded) return;
      isEnded = true;
      cancelAnimationFrame(animFrame);
      this.currentPlayingId = null;
      if (onPlayStateChange) onPlayStateChange(false);
      if (onWaveformUpdate) onWaveformUpdate(new Array(24).fill(0.1));
    };

    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.onpause = () => {
      if (this.currentPlayingId === voiceId) {
        cleanup();
      }
    };

    // Tạo visualizer nhịp điệu sóng âm khi audio VieNeu đang phát
    const startTime = Date.now();
    const updateWave = () => {
      if (this.currentPlayingId !== voiceId || isEnded) return;
      const elapsed = Date.now() - startTime;
      if (onWaveformUpdate) {
        const bars: number[] = [];
        for (let i = 0; i < 24; i++) {
          const val = Math.sin(elapsed / 100 + i * 0.4) * 0.4 +
              Math.cos(elapsed / 70 - i * 0.3) * 0.3 + 0.35;
          bars.push(Math.max(0.15, Math.min(1.0, val)));
        }
        onWaveformUpdate(bars);
      }
      animFrame = requestAnimationFrame(updateWave);
    };

    audio.onplay = () => {
      animFrame = requestAnimationFrame(updateWave);
    };

    audio.src = audioSrc;
    await audio.play();
  }
}

export const voicePreviewEngine = new VoicePreviewEngine();
