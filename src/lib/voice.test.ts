// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
describe('browser voice adapters', () => {
  it('prefers a local English voice and cancels speech on request', async () => {
    const local = { lang: 'en-GB', name: 'Local', localService: true };
    const synth = { getVoices: () => [{ lang: 'en-US', name: 'Google neural', localService: false }, local], cancel: vi.fn(), speak: vi.fn() };
    vi.stubGlobal('speechSynthesis', synth);
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    const { speak, stopSpeaking } = await import('./voice');
    speak('A short break could help.');
    expect(synth.speak.mock.calls[0][0].voice).toBe(local);
    stopSpeaking(); expect(synth.cancel).toHaveBeenCalledTimes(2);
  });
  it('reports denied microphone permission and ignores late transcripts after cancellation', async () => {
    let instance: any;
    vi.stubGlobal('SpeechRecognition', class { start = vi.fn(); stop = vi.fn(); constructor() { instance = this; } });
    const { listenOnce } = await import('./voice');
    const onText = vi.fn(), state = vi.fn();
    const stop = listenOnce(onText, state);
    instance.onerror({ error: 'not-allowed' });
    expect(state).toHaveBeenLastCalledWith(false, 'Microphone permission was denied.');
    const lateResult = instance.onresult;
    stop(); lateResult({ results: [[{ transcript: 'late transcript' }]] });
    expect(onText).not.toHaveBeenCalled();
    expect(instance.stop).toHaveBeenCalledOnce();
  });
  it('keeps typed chat usable if recognition cannot start', async () => {
    vi.stubGlobal('SpeechRecognition', class { start() { throw new Error('unavailable'); } stop() {} });
    const { listenOnce } = await import('./voice');
    const state = vi.fn();
    expect(() => listenOnce(vi.fn(), state)).not.toThrow();
    expect(state).toHaveBeenLastCalledWith(false, expect.stringContaining('type your message'));
  });
});
