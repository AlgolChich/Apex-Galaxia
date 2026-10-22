/**
 * A transport carries JSON-RPC messages between the webview and the MCP sidecar.
 *
 * - `tauri`: the Rust shell owns the sidecar process; `apex_send` writes one message to its
 *   stdin and every stdout line comes back as the `apex://message` event (ADR 0010).
 * - `http`: the dev bridge (`dev/bridge.mjs`) does the same over 127.0.0.1 for browser
 *   development and the Playwright smoke test. Never part of the shipped app.
 * - `mock`: in-memory, for unit tests of the client and the UI.
 */
export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface SidecarStatus {
  running: boolean;
  pid?: number;
  restarts: number;
  /** Where the model key came from at spawn: keychain, env, env-file or none. Never the key. */
  keySource: 'keychain' | 'env' | 'env-file' | 'none' | 'unknown';
}

export interface Transport {
  readonly kind: 'tauri' | 'http' | 'mock';
  send(message: JsonRpcMessage): Promise<void>;
  /** Every message from the sidecar: responses and notifications. Returns an unsubscribe. */
  onMessage(handler: (message: JsonRpcMessage) => void): () => void;
  /** Fired when the sidecar died or was restarted; the client re-initializes. */
  onReset(handler: (status: SidecarStatus) => void): () => void;
  status(): Promise<SidecarStatus>;
  /** Kill and respawn the sidecar (after a key change, or on request). */
  restart(): Promise<SidecarStatus>;
  /** Shell services that only the desktop shell can offer; absent in the browser. */
  readonly shell?: ShellServices;
}

export interface ShellServices {
  /** Store the model key in the OS keychain; the sidecar gets it through its environment at the next restart. */
  keySet(key: string): Promise<void>;
  keyExists(): Promise<boolean>;
  keyDelete(): Promise<void>;
  /** Native folder picker; undefined when cancelled. */
  pickFolder(options?: { title?: string; defaultPath?: string }): Promise<string | undefined>;
  /** Native file picker (a voice sample, an import); undefined when cancelled. */
  pickFile(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | undefined>;
  openPath(path: string): Promise<void>;
  /** App paths: the bundled resources (narrators, prompts, style) and the user dir. */
  paths(): Promise<{ resources: string; userDir: string; appData: string }>;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __APEX_TRANSPORT__?: Transport;
  }
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}
