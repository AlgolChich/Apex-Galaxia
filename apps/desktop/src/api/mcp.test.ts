import { describe, expect, it } from 'vitest';
import { ApexClient } from './client.js';
import { ToolError } from './mcp.js';
import { MockTransport } from './transport.mock.js';

describe('MCP client over a mock transport', () => {
  it('initializes once, calls tools and returns structured payloads', async () => {
    const transport = new MockTransport({
      model_status: () => ({ provider: 'replay', key_source: 'scripted', scripted: true, has_model: true, exact_token_counts: false, models: null, project: null }),
      project_open: (args) => ({ root: args['path'], config: { title: 'T' }, chapters: [], spentUsd: 0 }),
    });
    const client = new ApexClient(transport);
    const status = await client.modelStatus();
    expect(status.scripted).toBe(true);
    const opened = await client.projectOpen('/p');
    expect(opened.root).toBe('/p');
    const methods = transport.sent.map((m) => ('method' in m ? m.method : 'response'));
    expect(methods.filter((m) => m === 'initialize')).toHaveLength(1);
    expect(methods).toContain('notifications/initialized');
  });

  it('streams progress deltas into onDelta and surfaces tool errors with their code', async () => {
    const transport = new MockTransport({
      write_continue: (_args, emit, request) => {
        const token = (request.params as { _meta?: { progressToken?: number } })._meta?.progressToken;
        expect(token).toBe(request.id);
        emit({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: 3, message: 'Скаут ' } });
        emit({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: 6, message: 'бежал.' } });
        return { suggestion: { id: 'sug-1', status: 'pending' }, text: 'Скаут бежал.', lint: { hits: [], counts: { info: 0, warning: 0, error: 0 }, words: 2, paragraphs: 1 }, costUsd: 0, model: 'scripted', warnings: [] };
      },
      lint: () => ({ content: [{ type: 'text', text: '[ADAPTER_ERROR] no key' }], isError: true }),
    });
    const client = new ApexClient(transport);
    const deltas: string[] = [];
    const result = await client.writeContinue({ chapter: 1 }, (d) => deltas.push(d));
    expect(deltas.join('')).toBe('Скаут бежал.');
    expect(result.suggestion.id).toBe('sug-1');
    await expect(client.lint({ text: 'x' })).rejects.toMatchObject({ name: 'ToolError', code: 'ADAPTER_ERROR' });
    try {
      await client.lint({ text: 'x' });
    } catch (error) {
      expect(error).toBeInstanceOf(ToolError);
      expect((error as ToolError).tool).toBe('lint');
    }
  });

  it('delivers run events from logging notifications and re-initializes after a reset', async () => {
    const transport = new MockTransport({
      run_start: (_args, emit) => {
        emit({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', logger: 'apex.run', data: { run_id: 'run-1', delta: 'Глава' } } });
        emit({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', logger: 'other', data: { run_id: 'nope' } } });
        return { id: 'run-1', state: { id: 'run-1', status: 'running' } };
      },
    });
    const client = new ApexClient(transport);
    const events: string[] = [];
    client.onRunEvent((e) => events.push(e.run_id));
    const started = await client.runStart({ chapters: 1 });
    expect(started.id).toBe('run-1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['run-1']);
    let resets = 0;
    client.onReset(() => (resets += 1));
    await transport.restart();
    expect(resets).toBe(1);
    await client.runStart({});
    const inits = transport.sent.filter((m) => 'method' in m && m.method === 'initialize');
    expect(inits).toHaveLength(2);
  });
});
