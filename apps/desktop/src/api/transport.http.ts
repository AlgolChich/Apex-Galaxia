import type { JsonRpcMessage, SidecarStatus, Transport } from './transport.js';

/**
 * Browser development transport: talks to `dev/bridge.mjs`, which spawns the MCP server
 * and relays stdin/stdout over 127.0.0.1. Used by `pnpm dev` without Tauri and by the
 * Playwright smoke test. The shipped app never opens a port (ADR 0010).
 */
export class HttpTransport implements Transport {
  readonly kind = 'http' as const;
  private readonly handlers = new Set<(message: JsonRpcMessage) => void>();
  private readonly resetHandlers = new Set<(status: SidecarStatus) => void>();
  private source: EventSource | undefined;

  constructor(private readonly base = 'http://127.0.0.1:4877') {}

  private ensureSource(): void {
    if (this.source) return;
    this.source = new EventSource(`${this.base}/events`);
    this.source.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as JsonRpcMessage;
        for (const handler of this.handlers) handler(message);
      } catch {
        // a malformed line from the bridge is dropped; the client times out the request
      }
    };
    this.source.addEventListener('reset', (event) => {
      try {
        const status = JSON.parse((event as MessageEvent).data as string) as SidecarStatus;
        for (const handler of this.resetHandlers) handler(status);
      } catch {
        // ignore
      }
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    this.ensureSource();
    const response = await fetch(`${this.base}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) });
    if (!response.ok) throw new Error(`bridge: ${response.status} ${await response.text()}`);
  }

  onMessage(handler: (message: JsonRpcMessage) => void): () => void {
    this.ensureSource();
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onReset(handler: (status: SidecarStatus) => void): () => void {
    this.ensureSource();
    this.resetHandlers.add(handler);
    return () => this.resetHandlers.delete(handler);
  }

  async status(): Promise<SidecarStatus> {
    const response = await fetch(`${this.base}/status`);
    return (await response.json()) as SidecarStatus;
  }

  async restart(): Promise<SidecarStatus> {
    const response = await fetch(`${this.base}/restart`, { method: 'POST' });
    return (await response.json()) as SidecarStatus;
  }
}
