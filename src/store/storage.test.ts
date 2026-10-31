// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const idb = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }));
vi.mock('idb-keyval', () => idb);
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); idb.set.mockResolvedValue(undefined); idb.del.mockResolvedValue(undefined); idb.get.mockResolvedValue(undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('resilient storage', () => {
  it('falls back from IndexedDB and from localStorage quota errors without stale reads', async () => {
    vi.stubGlobal('indexedDB', {});
    const { resilientStorage: s, storageMode } = await import('./storage');
    await s.setItem('state', 'first');
    expect(storageMode()).toBe('idb');
    idb.set.mockRejectedValue(new Error('IDB unavailable'));
    await s.setItem('state', 'second');
    expect(storageMode()).toBe('local');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    await s.setItem('state', 'latest');
    expect(storageMode()).toBe('memory');
    expect(await s.getItem('state')).toBe('latest');
    await s.removeItem('state');
    expect(await s.getItem('state')).toBeNull();
  });
  it('preserves ordering of concurrent writes and deletion', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const { resilientStorage: s } = await import('./storage');
    await Promise.all([s.setItem('state', 'a'), s.setItem('state', 'b'), s.removeItem('state')]);
    expect(await s.getItem('state')).toBeNull();
    expect(localStorage.getItem('state')).toBeNull();
  });
  it('hydrates from fallback storage when IndexedDB reads fail', async () => {
    vi.stubGlobal('indexedDB', {});
    localStorage.setItem('state', 'backup');
    idb.get.mockRejectedValue(new Error('Read failed'));
    const { resilientStorage: s, storageMode } = await import('./storage');
    expect(await s.getItem('state')).toBe('backup');
    expect(storageMode()).toBe('local');
  });
});
