import { ApexClient } from './client.js';
import { HttpTransport } from './transport.http.js';
import { TauriTransport } from './transport.tauri.js';
import { isTauri, type Transport } from './transport.js';

export * from './client.js';
export * from './mcp.js';
export * from './transport.js';
export * from './types.js';
export { HttpTransport } from './transport.http.js';
export { MockTransport, type MockTool } from './transport.mock.js';

let instance: ApexClient | undefined;

/** Pick the transport for this environment: the Tauri shell, else the dev bridge. Tests inject their own. */
export function createTransport(): Transport {
  if (typeof window !== 'undefined' && window.__APEX_TRANSPORT__) return window.__APEX_TRANSPORT__;
  if (isTauri()) return new TauriTransport();
  const base = (import.meta.env?.['VITE_APEX_BRIDGE'] as string | undefined) ?? 'http://127.0.0.1:4877';
  return new HttpTransport(base);
}

export function getClient(): ApexClient {
  instance ??= new ApexClient(createTransport());
  return instance;
}

/** For tests: replace the shared client (pass undefined to reset to the environment default). */
export function setClient(client: ApexClient | undefined): void {
  instance = client;
}
