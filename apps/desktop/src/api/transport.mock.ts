import type { JsonRpcMessage, JsonRpcRequest, SidecarStatus, Transport } from './transport.js';

export type MockTool = (args: Record<string, unknown>, emit: (notification: JsonRpcMessage) => void, request: JsonRpcRequest) => unknown | Promise<unknown>;

/**
 * In-memory transport for unit tests: tools are plain functions; `emit` lets a tool send
 * notifications (progress, logging) before it answers, exactly as the sidecar would.
 */
export class MockTransport implements Transport {
  readonly kind = 'mock' as const;
  private readonly handlers = new Set<(message: JsonRpcMessage) => void>();
  private readonly resetHandlers = new Set<(status: SidecarStatus) => void>();
  readonly sent: JsonRpcMessage[] = [];
  restarts = 0;

  constructor(private readonly tools: Record<string, MockTool> = {}) {}

  private emit(message: JsonRpcMessage): void {
    queueMicrotask(() => {
      for (const handler of this.handlers) handler(message);
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    this.sent.push(message);
    if (!('id' in message) || !('method' in message)) return;
    const request = message;
    const reply = (result: unknown) => this.emit({ jsonrpc: '2.0', id: request.id, result });
    const fail = (code: number, text: string) => this.emit({ jsonrpc: '2.0', id: request.id, error: { code, message: text } });
    switch (request.method) {
      case 'initialize':
        reply({ protocolVersion: '2025-06-18', capabilities: { tools: {}, logging: {} }, serverInfo: { name: 'mock', version: '0' } });
        return;
      case 'tools/list':
        reply({ tools: Object.keys(this.tools).map((name) => ({ name, inputSchema: { type: 'object' } })) });
        return;
      case 'tools/call': {
        const params = request.params as { name: string; arguments?: Record<string, unknown>; _meta?: { progressToken?: string | number } };
        const tool = this.tools[params.name];
        if (!tool) {
          fail(-32601, `Unknown tool ${params.name}`);
          return;
        }
        try {
          const result = await tool(params.arguments ?? {}, (n) => this.emit(n), request);
          if (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>)) reply(result);
          else reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
        } catch (error) {
          reply({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
        }
        return;
      }
      default:
        fail(-32601, `Unknown method ${request.method}`);
    }
  }

  onMessage(handler: (message: JsonRpcMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onReset(handler: (status: SidecarStatus) => void): () => void {
    this.resetHandlers.add(handler);
    return () => this.resetHandlers.delete(handler);
  }

  async status(): Promise<SidecarStatus> {
    return { running: true, restarts: this.restarts, keySource: 'none' };
  }

  async restart(): Promise<SidecarStatus> {
    this.restarts += 1;
    const status = await this.status();
    for (const handler of this.resetHandlers) handler(status);
    return status;
  }
}
