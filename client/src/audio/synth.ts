/**
 * 音效系統 —— 全部用 Web Audio 即時合成，不依賴任何音檔。
 * 沒有素材音檔，而且合成版零載入時間、離線也能用。
 */

export type SoundName =
  | 'play'      // 出牌
  | 'draw'      // 抽牌
  | 'uno'       // 喊 UNO
  | 'caught'    // 被抓 UNO
  | 'win'       // 勝利
  | 'lose'      // 落敗
  | 'click'     // 按鈕
  | 'turn'      // 輪到你
  | 'join';     // 有人加入

const SFX_KEY = 'uno.sfx';
const BGM_KEY = 'uno.bgm';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bgm: { stop: () => void } | null = null;

let sfxOn = localStorage.getItem(SFX_KEY) !== 'off';
let bgmOn = localStorage.getItem(BGM_KEY) === 'on';

function ensure(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.28;
    master.connect(ctx.destination);
  }
  // 瀏覽器的 autoplay 政策：要等使用者互動過才會脫離 suspended
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 單音：帶 ADSR 包絡的振盪器 */
function tone(
  at: number,
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; sweepTo?: number } = {},
) {
  if (!ctx || !master) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const peak = opts.gain ?? 0.5;

  osc.type = opts.type ?? 'triangle';
  osc.frequency.setValueAtTime(freq, at);
  if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(opts.sweepTo, at + dur);

  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

  osc.connect(env).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** 噪音爆：卡片摩擦、抽牌之類的質感 */
function noise(at: number, dur: number, opts: { freq?: number; q?: number; gain?: number } = {}) {
  if (!ctx || !master) return;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = opts.freq ?? 1400;
  filter.Q.value = opts.q ?? 1.1;

  const env = ctx.createGain();
  env.gain.value = opts.gain ?? 0.5;

  src.connect(filter).connect(env).connect(master);
  src.start(at);
  src.stop(at + dur);
}

export function playSound(name: SoundName): void {
  if (!sfxOn) return;
  const audio = ensure();
  if (!audio) return;
  const t = audio.currentTime;

  switch (name) {
    case 'play':
      noise(t, 0.12, { freq: 2000, q: 0.8, gain: 0.4 });
      tone(t, 520, 0.09, { type: 'square', gain: 0.16 });
      break;
    case 'draw':
      noise(t, 0.16, { freq: 800, q: 0.9, gain: 0.35 });
      break;
    case 'uno':
      [660, 880, 1320].forEach((f, i) => tone(t + i * 0.09, f, 0.22, { type: 'triangle', gain: 0.45 }));
      break;
    case 'caught':
      tone(t, 420, 0.3, { type: 'sawtooth', gain: 0.3, sweepTo: 160 });
      tone(t + 0.05, 300, 0.32, { type: 'square', gain: 0.18, sweepTo: 120 });
      break;
    case 'win':
      [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, f, 0.34, { type: 'triangle', gain: 0.5 }));
      break;
    case 'lose':
      [440, 392, 330].forEach((f, i) => tone(t + i * 0.13, f, 0.28, { type: 'sine', gain: 0.32 }));
      break;
    case 'click':
      tone(t, 720, 0.05, { type: 'square', gain: 0.14 });
      break;
    case 'turn':
      tone(t, 880, 0.12, { type: 'sine', gain: 0.32 });
      tone(t + 0.1, 1175, 0.14, { type: 'sine', gain: 0.28 });
      break;
    case 'join':
      tone(t, 587, 0.1, { type: 'triangle', gain: 0.26 });
      tone(t + 0.08, 784, 0.14, { type: 'triangle', gain: 0.24 });
      break;
  }
}

// ------------------------------------------------------------------- BGM

/** 輕柔的四和弦循環墊，音量刻意壓很低 */
function startBgm(): void {
  const audio = ensure();
  if (!audio || !master || bgm) return;

  const gain = audio.createGain();
  gain.gain.value = 0.05;
  gain.connect(master);

  const chords = [
    [261.6, 329.6, 392.0], // C
    [220.0, 277.2, 329.6], // Am
    [174.6, 220.0, 261.6], // F
    [196.0, 246.9, 293.7], // G
  ];

  let step = 0;
  let stopped = false;

  const tick = () => {
    if (stopped || !ctx) return;
    const at = ctx.currentTime;
    for (const f of chords[step % chords.length]) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.5, at + 0.6);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 2.4);
      osc.connect(env).connect(gain);
      osc.start(at);
      osc.stop(at + 2.5);
    }
    step += 1;
  };

  tick();
  const timer = setInterval(tick, 2400);
  bgm = {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      gain.disconnect();
      bgm = null;
    },
  };
}

// ---------------------------------------------------------------- 開關

export const isSfxOn = (): boolean => sfxOn;
export const isBgmOn = (): boolean => bgmOn;

export function setSfx(on: boolean): void {
  sfxOn = on;
  localStorage.setItem(SFX_KEY, on ? 'on' : 'off');
  if (on) playSound('click');
}

export function setBgm(on: boolean): void {
  bgmOn = on;
  localStorage.setItem(BGM_KEY, on ? 'on' : 'off');
  if (on) startBgm();
  else bgm?.stop();
}

/** 首次使用者互動時呼叫，解開 autoplay 限制 */
export function unlockAudio(): void {
  ensure();
  if (bgmOn && !bgm) startBgm();
}
