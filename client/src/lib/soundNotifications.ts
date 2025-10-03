class SoundNotificationService {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioContext;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private playTone(frequency: number, duration: number, volume: number = 0.3, type: OscillatorType = 'sine') {
    if (!this.enabled) return;

    try {
      const ctx = this.getAudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gainNode.gain.setValueAtTime(volume, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + duration);
    } catch (error) {
      console.warn('Failed to play sound:', error);
    }
  }

  private playMultiTone(tones: Array<{ freq: number; delay: number; duration: number; volume?: number; type?: OscillatorType }>) {
    if (!this.enabled) return;

    tones.forEach(({ freq, delay, duration, volume, type }) => {
      setTimeout(() => {
        this.playTone(freq, duration, volume, type);
      }, delay);
    });
  }

  newTrade() {
    this.playMultiTone([
      { freq: 800, delay: 0, duration: 0.08, volume: 0.25, type: 'sine' },
      { freq: 1000, delay: 70, duration: 0.08, volume: 0.25, type: 'sine' },
      { freq: 1200, delay: 140, duration: 0.12, volume: 0.3, type: 'sine' },
    ]);
  }

  layerAdded() {
    this.playMultiTone([
      { freq: 1400, delay: 0, duration: 0.06, volume: 0.2, type: 'sine' },
      { freq: 1600, delay: 50, duration: 0.06, volume: 0.2, type: 'sine' },
    ]);
  }

  takeProfitHit() {
    this.playMultiTone([
      { freq: 800, delay: 0, duration: 0.1, volume: 0.25, type: 'sine' },
      { freq: 1000, delay: 80, duration: 0.1, volume: 0.25, type: 'sine' },
      { freq: 1200, delay: 160, duration: 0.15, volume: 0.28, type: 'sine' },
      { freq: 1400, delay: 260, duration: 0.2, volume: 0.3, type: 'sine' },
    ]);
  }

  stopLossHit() {
    this.playMultiTone([
      { freq: 400, delay: 0, duration: 0.15, volume: 0.28, type: 'sine' },
      { freq: 350, delay: 120, duration: 0.15, volume: 0.28, type: 'sine' },
      { freq: 300, delay: 240, duration: 0.2, volume: 0.3, type: 'sine' },
    ]);
  }
}

export const soundNotifications = new SoundNotificationService();
