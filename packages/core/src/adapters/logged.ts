import { isoNow, shortId } from '../util/fs.js';
import type { ProjectStore } from '../project/store.js';
import type { GenerateOptions, GenerateResult, ModelAdapter } from './types.js';

export interface LoggedResult extends GenerateResult {
  callId: string;
}

/**
 * Run one generation and append it to the project's call log (history/calls.jsonl):
 * prompt hash, model, tokens, cost, latency, acceptance (updated later). This is the
 * append-only log Section 8.2 asks for, kept in the project so it travels with the story.
 */
export async function generateLogged(
  adapter: ModelAdapter,
  store: ProjectStore,
  options: GenerateOptions,
): Promise<LoggedResult> {
  const callId = shortId('call');
  const result = await adapter.generate(options);
  await store.appendCall({
    id: callId,
    ts: isoNow(),
    task: options.task,
    provider: result.provider,
    model: result.model,
    prompt_hash: result.promptHash,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    cache_read_tokens: result.usage.cacheReadTokens,
    cache_write_tokens: result.usage.cacheWriteTokens,
    cost_usd: result.costUsd,
    latency_ms: result.latencyMs,
    accepted: null,
    replay: result.replay,
  });
  return { ...result, callId };
}
