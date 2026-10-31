/**
 * Loads an optional .env file before any other server module reads process.env.
 * Imported first by server/index.ts (ESM evaluates imports in order).
 */
import * as tls from 'node:tls';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env: the coach runs in offline template mode.
}

// Opt in on networks using an OS-trusted certificate authority. Preserve the bundled
// roots and certificate/hostname verification; never use NODE_TLS_REJECT_UNAUTHORIZED=0.
if (process.env.COACH_USE_SYSTEM_CA === 'true' && typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function') {
  tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
}

export {};
