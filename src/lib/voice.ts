/**
 * Voice coaching (bonus feature). Speech output prefers a local browser voice; some
 * voices use vendor servers. Speech input uses the Web Speech API, sometimes processed by
 * the browser vendor's servers — the consent screen says so, and it is off by default.
 * No audio is ever recorded or stored by CogniTwin.
 */

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  const available = window.speechSynthesis.getVoices();
  const local = available.filter((v) => v.localService);
  const voices = local.some((v) => /^en/i.test(v.lang)) ? local : available;
  cachedVoice =
    voices.find((v) => /en[-_](GB|US)/i.test(v.lang) && /natural|neural|google|samantha|daniel/i.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null;
  return cachedVoice;
}

export function speak(text: string, opts: { rate?: number; onEnd?: () => void } = {}): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[–—]/g, ', '));
  const v = pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'en-GB';
  u.rate = opts.rate ?? 1;
  if (opts.onEnd) u.onend = opts.onEnd;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = () => typeof window !== 'undefined' && recognitionCtor() !== null;

/** Listen for one utterance. Returns a stop function. */
export function listenOnce(onText: (text: string) => void, onState: (listening: boolean, error?: string) => void): () => void {
  const Ctor = recognitionCtor();
  if (!Ctor) {
    onState(false, 'Voice input is not supported in this browser.');
    return () => {};
  }
  const r = new Ctor();
  let stopped = false;
  r.lang = 'en-US';
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    if (stopped) return;
    const text = e.results[0]?.[0]?.transcript ?? '';
    if (text) onText(text);
  };
  r.onerror = (e) => onState(false, e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Voice input error: ${e.error}`);
  r.onend = () => onState(false);
  onState(true);
  try { r.start(); }
  catch { stopped = true; onState(false, 'Voice input could not start. You can type your message instead.'); }
  return () => {
    stopped = true;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try { r.stop(); } catch { /* Already stopped. */ }
    onState(false);
  };
}
