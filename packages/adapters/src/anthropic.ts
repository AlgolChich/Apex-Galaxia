import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  ApexError,
  ModelRegistry,
  estimateCost,
  promptHash,
  schemaByName,
  type CountTokensInput,
  type Effort,
  type GenerateOptions,
  type GenerateResult,
  type ModelAdapter,
  type StopReason,
  type TaskKind,
} from '@apex-galaxia/core';

export interface AnthropicAdapterOptions {
  apiKey?: string;
  baseURL?: string;
  registry?: ModelRegistry;
  maxRetries?: number;
  timeoutMs?: number;
  /** An existing client, for tests or custom transports. */
  client?: Anthropic;
}

/**
 * Effort per task kind. Current Claude models take no temperature; effort is the lever.
 * Prose runs at medium (room for the sentence, not for deliberation), planning and critique
 * at high with thinking on by default, extraction and summaries at low.
 */
export const EFFORT_BY_KIND: Record<TaskKind, Effort> = {
  prose: 'medium',
  planning: 'high',
  critique: 'high',
  extraction: 'low',
  summary: 'low',
  lint: 'low',
};

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

interface StreamOutcome {
  text: string;
  model: string;
  stopReason: string | null;
  stopDetails: { category?: string | null; explanation?: string | null } | null | undefined;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

function mapStop(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/** The Anthropic adapter: official SDK, streaming, prompt caching, structured output, exact token counts. */
export class AnthropicAdapter implements ModelAdapter {
  readonly provider = 'anthropic' as const;
  readonly exactTokenCounts = true;
  private readonly client: Anthropic;
  private readonly registry: ModelRegistry;

  constructor(options: AnthropicAdapterOptions = {}) {
    this.registry = options.registry ?? new ModelRegistry();
    this.client =
      options.client ??
      new Anthropic({
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(options.baseURL ? { baseURL: options.baseURL } : {}),
        maxRetries: options.maxRetries ?? 3,
        timeout: options.timeoutMs ?? 10 * 60 * 1000,
      });
  }

  private buildParams(options: GenerateOptions): Anthropic.MessageCreateParamsNonStreaming {
    const system: Anthropic.TextBlockParam[] = options.system.map((block) =>
      block.cache
        ? { type: 'text', text: block.text, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text: block.text },
    );
    const messages: Anthropic.MessageParam[] = options.messages.map((m) => ({ role: m.role, content: m.content }));
    const effort = options.effort ?? EFFORT_BY_KIND[options.kind];
    const zodSchema = options.jsonSchemaName ? schemaByName(options.jsonSchemaName) : undefined;
    const format: Anthropic.JSONOutputFormat | undefined = zodSchema
      ? zodOutputFormat(zodSchema)
      : options.jsonSchema
        ? { type: 'json_schema', schema: options.jsonSchema }
        : undefined;
    return {
      model: options.model,
      max_tokens: options.maxTokens ?? 16_000,
      system,
      messages,
      output_config: { effort, ...(format ? { format } : {}) },
      ...(options.stopSequences && options.stopSequences.length > 0 ? { stop_sequences: options.stopSequences } : {}),
    };
  }

  private async streamStandard(params: Anthropic.MessageCreateParamsNonStreaming, options: GenerateOptions): Promise<StreamOutcome> {
    const stream = this.client.messages.stream(params, options.signal ? { signal: options.signal } : {});
    if (options.onDelta) {
      const onDelta = options.onDelta;
      stream.on('text', (delta: string) => onDelta(delta));
    }
    const message = await stream.finalMessage();
    return {
      text: message.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
      model: message.model,
      stopReason: message.stop_reason,
      stopDetails: message.stop_details,
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }

  /** Same call through the beta surface with the server-side refusal fallback (Section 5.4). */
  private async streamWithFallback(params: Anthropic.MessageCreateParamsNonStreaming, options: GenerateOptions): Promise<StreamOutcome> {
    const betaParams: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model: params.model,
      max_tokens: params.max_tokens,
      system: params.system as Anthropic.Beta.Messages.BetaTextBlockParam[],
      messages: params.messages as Anthropic.Beta.Messages.BetaMessageParam[],
      output_config: params.output_config as Anthropic.Beta.Messages.BetaOutputConfig,
      ...(params.stop_sequences ? { stop_sequences: params.stop_sequences } : {}),
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
    };
    const stream = this.client.beta.messages.stream(betaParams, options.signal ? { signal: options.signal } : {});
    if (options.onDelta) {
      const onDelta = options.onDelta;
      stream.on('text', (delta: string) => onDelta(delta));
    }
    const message = await stream.finalMessage();
    return {
      text: message.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
      model: message.model,
      stopReason: message.stop_reason,
      stopDetails: (message as { stop_details?: StreamOutcome['stopDetails'] }).stop_details,
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const started = Date.now();
    const params = this.buildParams(options);
    try {
      const outcome = options.fallbacks ? await this.streamWithFallback(params, options) : await this.streamStandard(params, options);
      const usage = {
        inputTokens: outcome.usage.input,
        outputTokens: outcome.usage.output,
        cacheReadTokens: outcome.usage.cacheRead,
        cacheWriteTokens: outcome.usage.cacheWrite,
      };
      const stopReason = mapStop(outcome.stopReason);
      const result: GenerateResult = {
        text: outcome.text,
        usage,
        model: outcome.model,
        provider: 'anthropic',
        stopReason,
        latencyMs: Date.now() - started,
        costUsd: estimateCost(this.registry.get(outcome.model) ?? this.registry.get(options.model), usage),
        promptHash: promptHash(options),
        replay: false,
      };
      if (stopReason === 'refusal') {
        result.refusal = {
          ...(outcome.stopDetails?.category ? { category: outcome.stopDetails.category } : {}),
          ...(outcome.stopDetails?.explanation ? { explanation: outcome.stopDetails.explanation } : {}),
        };
      }
      if (options.jsonSchema || options.jsonSchemaName) {
        try {
          result.json = JSON.parse(outcome.text);
        } catch {
          // the core's contract check reports an unparseable response
        }
      }
      return result;
    } catch (error) {
      if (error instanceof ApexError) throw error;
      if (error instanceof Anthropic.APIError) {
        throw new ApexError('ADAPTER_ERROR', `Anthropic API error ${error.status ?? ''}: ${error.message}`, {
          status: error.status,
          name: error.name,
        });
      }
      throw new ApexError('ADAPTER_ERROR', error instanceof Error ? error.message : String(error));
    }
  }

  async countTokens(input: CountTokensInput): Promise<number> {
    const messages: Anthropic.MessageParam[] =
      input.messages && input.messages.length > 0
        ? input.messages.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: input.text && input.text.length > 0 ? input.text : ' ' }];
    const system: Anthropic.TextBlockParam[] | undefined = input.system?.map((b) => ({ type: 'text', text: b.text }));
    try {
      const response = await this.client.messages.countTokens({
        model: input.model,
        messages,
        ...(system && system.length > 0 ? { system } : {}),
      });
      return response.input_tokens;
    } catch (error) {
      throw new ApexError('ADAPTER_ERROR', `countTokens failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
