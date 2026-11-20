/**
 * 零依賴 Web Audio API 8-bit 合成音效引擎
 */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
  }

  unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playTone({ freq = 440, endFreq = null, type = 'square', duration = 0.1, gain = 0.08, delay = 0 }) {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    try {
      const now = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (endFreq !== null && endFreq !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
      }

      amp.gain.setValueAtTime(gain, now);
      amp.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(amp);
      amp.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (_) {
      // 忽略瀏覽器尚未解鎖音訊時的例外
    }
  }

  play(name) {
    if (this.muted) return;
    switch (name) {
      case 'dig':
        this.playTone({ freq: 520, endFreq: 160, type: 'sawtooth', duration: 0.14, gain: 0.08 });
        break;
      case 'step':
        this.playTone({ freq: 180, endFreq: 120, type: 'triangle', duration: 0.035, gain: 0.03 });
        break;
      case 'chestOpen':
        this.playTone({ freq: 523, duration: 0.08, type: 'square', gain: 0.07, delay: 0 });
        this.playTone({ freq: 659, duration: 0.09, type: 'square', gain: 0.07, delay: 0.07 });
        this.playTone({ freq: 784, duration: 0.14, type: 'square', gain: 0.07, delay: 0.15 });
        break;
      case 'correct':
        this.playTone({ freq: 587, duration: 0.08, type: 'triangle', gain: 0.1, delay: 0 });
        this.playTone({ freq: 784, duration: 0.09, type: 'triangle', gain: 0.1, delay: 0.08 });
        this.playTone({ freq: 1046, duration: 0.2, type: 'triangle', gain: 0.1, delay: 0.17 });
        break;
      case 'wrong':
        this.playTone({ freq: 260, endFreq: 130, type: 'sawtooth', duration: 0.18, gain: 0.09, delay: 0 });
        this.playTone({ freq: 190, endFreq: 95, type: 'sawtooth', duration: 0.24, gain: 0.09, delay: 0.16 });
        break;
      case 'trap':
        this.playTone({ freq: 420, endFreq: 180, type: 'square', duration: 0.16, gain: 0.07 });
        break;
      case 'crush':
        this.playTone({ freq: 240, endFreq: 680, type: 'square', duration: 0.12, gain: 0.08, delay: 0 });
        this.playTone({ freq: 680, endFreq: 920, type: 'triangle', duration: 0.14, gain: 0.08, delay: 0.1 });
        break;
      case 'exitReveal':
        [523, 659, 784, 1046, 1318].forEach((f, i) => {
          this.playTone({ freq: f, duration: 0.14, type: 'triangle', gain: 0.08, delay: i * 0.07 });
        });
        break;
      case 'hurt':
        this.playTone({ freq: 380, endFreq: 90, type: 'sawtooth', duration: 0.35, gain: 0.11 });
        break;
      case 'levelClear':
        [523, 659, 784, 659, 1046].forEach((f, i) => {
          this.playTone({ freq: f, duration: i === 4 ? 0.35 : 0.11, type: 'square', gain: 0.08, delay: i * 0.1 });
        });
        break;
      case 'gameOver':
        [392, 349, 311, 261].forEach((f, i) => {
          this.playTone({ freq: f, duration: i === 3 ? 0.4 : 0.16, type: 'sawtooth', gain: 0.08, delay: i * 0.15 });
        });
        break;
      case 'tick':
        this.playTone({ freq: 880, duration: 0.04, type: 'sine', gain: 0.04 });
        break;
      default:
        break;
    }
  }
}

export const audio = new SoundEngine();
