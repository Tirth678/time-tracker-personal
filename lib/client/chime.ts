/**
 * A soft two-note chime, synthesised with Web Audio (no audio file to load).
 *
 * Browsers only allow sound after the user has interacted with the page, so
 * `prepare()` is called from the Start button's click handler; the chime that
 * plays 25 minutes later, without any click, is then allowed.
 */

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (context) return context;
  try {
    context = new AudioContext();
  } catch {
    context = null; // No Web Audio: the app simply stays silent.
  }
  return context;
}

/** Call from a click or key handler. */
export function prepareChime(): void {
  const audio = getContext();
  if (audio?.state === "suspended") void audio.resume().catch(() => {});
}

function note(audio: AudioContext, frequency: number, startAt: number, duration: number, peak: number): void {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  // A fast attack and a long exponential tail sound like a struck bell.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.05);
}

/** `rest`: time for a break (falling notes). `focus`: back to work (rising notes). */
export function playChime(kind: "rest" | "focus"): void {
  const audio = getContext();
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume().catch(() => {});

  const [first, second] = kind === "rest" ? [783.99, 587.33] : [587.33, 783.99]; // G5 and D5
  const start = audio.currentTime + 0.05;
  for (const [frequency, offset] of [
    [first, 0],
    [second, 0.28],
  ] as const) {
    note(audio, frequency, start + offset, 1.6, 0.16);
    note(audio, frequency * 2, start + offset, 0.9, 0.04); // a quiet octave above adds shimmer
  }
}
