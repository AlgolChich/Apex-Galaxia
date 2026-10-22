import type { JsonRpcId, JsonRpcMessage, JsonRpcNotification, JsonRpcResponse, SidecarStatus, Transport } from './transport.js';

export interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ProgressEvent {
  progress: number;
  total?: number;
  message?: string;
}

export interface CallOptions {
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class ToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (event: ProgressEvent) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * A small MCP client over any Transport: initialize handshake, requests with progress
 * tokens, notifications in both directions, and re-initialization when the sidecar resets.
 */
export class McpConnection {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, Pending>();
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
  private ready: Promise<void> | undefined;
  serverInfo: { name: string; version: string } | undefined;

  constructor(readonly transport: Transport) {
    transport.onMessage((message) => this.receive(message));
    transport.onReset((status) => this.reset(status));
  }

  /** Perform the initialize handshake once; later calls await the same promise. */
  connect(): Promise<void> {
    this.ready ??= (async () => {
      const result = (await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'apex-galaxia-desktop', version: '0.1.0' },
      })) as { serverInfo?: { name: string; version: string } };
      this.serverInfo = result.serverInfo;
      await this.notify('notifications/initialized', {});
      try {
        await this.request('logging/setLevel', { level: 'info' });
      } catch {
        // a server without logging keeps working; runs just have no live view
      }
    })();
    return this.ready;
  }

  private reset(status: SidecarStatus): void {
    for (const [id, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new RpcError(-32000, `sidecar reset (${status.running ? 'restarted' : 'stopped'})`));
      this.pending.delete(id);
    }
    this.ready = undefined;
    const handlers = this.notificationHandlers.get('apex://reset');
    if (handlers) for (const h of handlers) h(status);
  }

  private receive(message: JsonRpcMessage): void {
    if ('id' in message && !('method' in message)) {
      const response = message as JsonRpcResponse;
      const p = this.pending.get(response.id);
      if (!p) return;
      this.pending.delete(response.id);
      if (p.timer) clearTimeout(p.timer);
      if (response.error) p.reject(new RpcError(response.error.code, response.error.message, response.error.data));
      else p.resolve(response.result);
      return;
    }
    if ('method' in message) {
      const n = message as JsonRpcNotification;
      if (n.method === 'notifications/progress') {
        const params = n.params as { progressToken: JsonRpcId; progress: number; total?: number; message?: string };
        const p = this.pending.get(params.progressToken);
        p?.onProgress?.({ progress: params.progress, ...(params.total !== undefined ? { total: params.total } : {}), ...(params.message !== undefined ? { message: params.message } : {}) });
      }
      const handlers = this.notificationHandlers.get(n.method);
      if (handlers) for (const h of handlers) h(n.params);
      if ('id' in message) {
        // a server-to-client request (sampling, elicitation): not supported by this client
        void this.transport.send({ jsonrpc: '2.0', id: (message as { id: JsonRpcId }).id, error: { code: -32601, message: 'not supported by the desktop client' } });
      }
    }
  }

  /** Subscribe to a notification method (`notifications/message`, `apex://reset`…). */
  onNotification(method: string, handler: (params: unknown) => void): () => void {
    let set = this.notificationHandlers.get(method);
    if (!set) {
      set = new Set();
      this.notificationHandlers.set(method, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.transport.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  request(method: string, params?: Record<string, unknown>, options: CallOptions = {}): Promise<unknown> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { ...(params ?? {}) };
    if (options.onProgress) payload['_meta'] = { ...((payload['_meta'] as Record<string, unknown> | undefined) ?? {}), progressToken: id };
    return new Promise<unknown>((resolve, reject) => {
      const entry: Pending = { resolve, reject, ...(options.onProgress ? { onProgress: options.onProgress } : {}) };
      const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (timeout > 0) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new RpcError(-32001, `${method} timed out after ${Math.round(timeout / 1000)}s`));
        }, timeout);
      }
      this.pending.set(id, entry);
      options.signal?.addEventListener('abort', () => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        void this.notify('notifications/cancelled', { requestId: id, reason: 'cancelled by the Author' });
        reject(new RpcError(-32002, `${method} cancelled`));
      });
      this.transport.send({ jsonrpc: '2.0', id, method, params: payload }).catch((error: unknown) => {
        this.pending.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async callTool(name: string, args: Record<string, unknown> = {}, options: CallOptions = {}): Promise<ToolResult> {
    await this.connect();
    const result = (await this.request('tools/call', { name, arguments: args }, options)) as ToolResult;
    if (result.isError) {
      const text = result.content.map((c) => c.text ?? '').join('\n');
      const code = /^\[([A-Z_]+)\]/.exec(text)?.[1];
      throw new ToolError(name, text, code);
    }
    return result;
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    await this.connect();
    const result = (await this.request('tools/list', {})) as { tools: Array<{ name: string; description?: string }> };
    return result.tools;
  }

  async readResource(uri: string): Promise<string> {
    await this.connect();
    const result = (await this.request('resources/read', { uri })) as { contents: Array<{ text?: string }> };
    return result.contents.map((c) => c.text ?? '').join('\n');
  }
}

/** The structured payload of a tool result, falling back to the JSON in its text. */
export function payload<T>(result: ToolResult): T {
  if (result.structuredContent) return result.structuredContent as T;
  const text = result.content.map((c) => c.text ?? '').join('\n');
  try {
    return JSON.parse(text) as T;
  } catch {
    return { text } as unknown as T;
  }
}

export function resultText(result: ToolResult): string {
  return result.content.map((c) => c.text ?? '').join('\n');
}
