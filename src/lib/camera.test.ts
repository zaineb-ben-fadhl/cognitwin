// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CameraCueTracker } from './camera';
const mocks = vi.hoisted(() => ({ files: vi.fn(), create: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({ FilesetResolver: { forVisionTasks: mocks.files }, FaceLandmarker: { createFromOptions: mocks.create } }));
beforeEach(() => { vi.clearAllMocks(); mocks.files.mockResolvedValue({}); });
afterEach(() => vi.unstubAllGlobals());
const video = () => ({ play: vi.fn().mockResolvedValue(undefined), srcObject: null, readyState: 0 }) as unknown as HTMLVideoElement;
const stream = (stop = vi.fn()) => ({ getTracks: () => [{ stop }] });
const media = (getUserMedia: ReturnType<typeof vi.fn>) => vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

describe('camera resource lifecycle', () => {
  it('stops a permission result that arrives after the session ended', async () => {
    let resolve!: (s: unknown) => void;
    media(vi.fn(() => new Promise((r) => { resolve = r; })));
    const stop = vi.fn();
    const tracker = new CameraCueTracker();
    const opening = tracker.start(video());
    tracker.stop();
    resolve(stream(stop));
    await opening;
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('releases the stream if model initialization fails', async () => {
    const stop = vi.fn(); media(vi.fn().mockResolvedValue(stream(stop)));
    mocks.create.mockRejectedValue(new Error('No model'));
    const v = video();
    await expect(new CameraCueTracker().start(v)).rejects.toThrow('No model');
    expect(stop).toHaveBeenCalledOnce(); expect(v.srcObject).toBeNull();
  });
  it('falls back to CPU and loads WASM from the application origin', async () => {
    const close = vi.fn(); const stop = vi.fn();
    media(vi.fn().mockResolvedValue(stream(stop)));
    mocks.create.mockRejectedValueOnce(new Error('No GPU')).mockResolvedValueOnce({ close, detectForVideo: vi.fn() });
    const tracker = new CameraCueTracker(); await tracker.start(video());
    expect(mocks.create.mock.calls[1][1].baseOptions.delegate).toBe('CPU');
    expect(mocks.files.mock.calls[0][0]).toMatch(/^\/?(?:\.\/)?models\/wasm$/);
    tracker.stop(); expect(close).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
  });
  it('closes a model that finishes loading after stop', async () => {
    const close = vi.fn(); let resolve!: (m: unknown) => void;
    media(vi.fn().mockResolvedValue(stream()));
    mocks.create.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const tracker = new CameraCueTracker(); const opening = tracker.start(video());
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled());
    tracker.stop(); resolve({ close }); await opening;
    expect(close).toHaveBeenCalledOnce();
  });
  it('reports denied permission without starting inference', async () => {
    media(vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')));
    await expect(new CameraCueTracker().start(video())).rejects.toMatchObject({ name:'NotAllowedError' });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
