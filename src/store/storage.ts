/**
 * Local-first persistence. IndexedDB (idb-keyval) when available, then localStorage, then
 * memory — so the app keeps working in private windows or locked-down browsers.
 */
import { del, get, set } from 'idb-keyval';
import type { StateStorage } from 'zustand/middleware';

const memory = new Map<string, string>();

async function idbWorks(): Promise<boolean> {
  try {
    await set('__probe__', '1');
    await del('__probe__');
    return true;
  } catch {
    return false;
  }
}

let mode: 'idb' | 'local' | 'memory' | null = null;
let probing: Promise<void> | null = null;
let pending: Promise<unknown> = Promise.resolve();

// Zustand can enqueue writes while hydration is in flight. Keep their order, including
// deletion, and prevent a rejected write from breaking the rest of the queue.
function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.catch(() => undefined);
  return result;
}

function localFallback() {
  try {
    localStorage.setItem('__probe__', '1');
    localStorage.removeItem('__probe__');
    mode = 'local';
  } catch { mode = 'memory'; }
}

async function resolveMode() {
  if (mode) return;
  probing ??= (async () => {
    if (typeof indexedDB !== 'undefined' && (await idbWorks())) mode = 'idb';
    else localFallback();
  })();
  await probing;
}

export function storageMode() {
  return mode;
}

export const resilientStorage: StateStorage = {
  getItem: (name) => ordered(async () => {
    await resolveMode();
    if (mode === 'idb') {
      try {
        const value = (await get<string>(name)) ?? null;
        if (value !== null) memory.set(name, value);
        return value;
      } catch { localFallback(); }
    }
    // After a failure, the latest in-session value is preferable to an older fallback.
    if (memory.has(name)) return memory.get(name)!;
    if (mode === 'local') {
      try {
        const value = localStorage.getItem(name);
        if (value !== null) memory.set(name, value);
        return value;
      } catch { mode = 'memory'; }
    }
    return memory.get(name) ?? null;
  }),
  setItem: (name, value) => ordered(async () => {
    await resolveMode();
    memory.set(name, value);
    if (mode === 'idb') {
      try { await set(name, value); return; }
      catch { localFallback(); }
    }
    if (mode === 'local') {
      try { localStorage.setItem(name, value); }
      catch { mode = 'memory'; }
    }
  }),
  removeItem: (name) => ordered(async () => {
    await resolveMode();
    memory.delete(name);
    if (mode === 'idb') {
      try { await del(name); }
      catch { localFallback(); }
    }
    try { localStorage.removeItem(name); }
    catch { if (mode !== 'idb') mode = 'memory'; }
  }),
};
