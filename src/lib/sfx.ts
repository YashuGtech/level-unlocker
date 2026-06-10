/**
 * Tiny WebAudio sound effects (no external assets).
 */
let _ctx: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!_ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    _ctx = new AC();
  }
  if (_ctx.state === "suspended") void _ctx.resume();
  return _ctx;
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  gain = 0.18,
  freqEnd?: number,
) {
  const c = ctx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime);
  if (freqEnd !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), c.currentTime + duration);
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + duration);
}

export const sfx = {
  flap: () => tone(520, 0.08, "square", 0.12, 320),
  coin: () => {
    tone(880, 0.06, "triangle", 0.14);
    setTimeout(() => tone(1320, 0.1, "triangle", 0.14), 50);
  },
  hit: () => tone(140, 0.32, "sawtooth", 0.22, 60),
  win: () => {
    tone(660, 0.12, "triangle", 0.18);
    setTimeout(() => tone(880, 0.12, "triangle", 0.18), 110);
    setTimeout(() => tone(1320, 0.22, "triangle", 0.2), 220);
  },
  click: () => tone(420, 0.05, "square", 0.1),
};
