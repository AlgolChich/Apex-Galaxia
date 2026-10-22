import { sha256 } from '../util/fs.js';

/**
 * The model adapter contract (Section 8.2). The core talks only to this interface; the
 * Anthropic adapter, the replay adapter for tests, and later OpenAI-compatible and Ollama
 * adapters implement it. Nothing product-level depends on a provider.
 */
export type Provider = 'anthropic' | 'openai-compatible' | 'ollama' | 'replay';

export interface ModelInfo {
  id: string;
  provider: Exclude<Provider, 'replay'>;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  /** US dollars per million tokens. */
  inputUsdPerM: number;
  outputUsdPerM: number;
  cacheReadUsdPerM: number;
  cacheWriteUsdPerM: number;
  /** Some models price long prompts differently (Haiku 5.5 beyond 100K tokens). */
  longContext?: { thresholdTokens: number; inputUsdPerM: number; outputUsdPerM: number };
  /** Whether the provider accepts sampling temperature; current Claude models do not. */
  supportsTemperature: boolean;
  supportsEffort: boolean;
  supportsThinking: boolean;
  supportsStructuredOutput: boolean;
}

/** A system prompt layer. Layers flagged `cache` end a prompt-cache prefix. */
export interface SystemBlock {
  text: string;
  cache?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Task kinds map to sampling behavior. Temperature is gone from current Claude models, so the
 * adapter maps `prose` to a prose-friendly effort and no thinking, `critique` to thinking at
 * moderate effort, `extraction` to the cheapest deterministic settings. Providers that still
 * take temperature get 0.95 / 0.3 / 0 respectively.
 */
export type TaskKind = 'prose' | 'planning' | 'critique' | 'extraction' | 'summary' | 'lint';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface GenerateOptions {
  model: string;
  system: SystemBlock[];
  messages: ChatMessage[];
  /** Name of the task for logs and the inspector, e.g. `write.continue`. */
  task: string;
  kind: TaskKind;
  maxTokens?: number;
  effort?: Effort;
  stopSequences?: string[];
  /** JSON Schema the response must satisfy; the adapter uses structured output where available. */
  jsonSchema?: Record<string, unknown>;
  /** Name of the core schema (SCHEMA_REGISTRY) behind `jsonSchema`, for adapters with typed helpers. */
  jsonSchemaName?: string;
  seed?: number;
  /** Streaming callback with text deltas as they arrive. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
  /** Enable the provider's server-side refusal fallback when available (Section 5.4). */
  fallbacks?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type StopReason = 'end' | 'max_tokens' | 'stop_sequence' | 'refusal' | 'other';

export interface GenerateResult {
  text: string;
  /** Parsed JSON when `jsonSchema` was requested and the response parsed. */
  json?: unknown;
  usage: Usage;
  model: string;
  provider: Provider;
  stopReason: StopReason;
  refusal?: { category?: string; explanation?: string };
  latencyMs: number;
  costUsd: number;
  promptHash: string;
  replay: boolean;
}

export interface CountTokensInput {
  model: string;
  system?: SystemBlock[];
  messages?: ChatMessage[];
  text?: string;
}

export interface ModelAdapter {
  readonly provider: Provider;
  generate(options: GenerateOptions): Promise<GenerateResult>;
  /** Exact token count from the provider when available; adapters may fall back to estimates. */
  countTokens(input: CountTokensInput): Promise<number>;
  /** Whether `countTokens` returns provider-exact counts. */
  readonly exactTokenCounts: boolean;
}

/** Stable hash of everything that shapes a response, so a result can be reproduced. */
export function promptHash(options: GenerateOptions): string {
  const material = {
    model: options.model,
    system: options.system.map((b) => b.text),
    messages: options.messages,
    maxTokens: options.maxTokens ?? null,
    effort: options.effort ?? null,
    kind: options.kind,
    jsonSchema: options.jsonSchema ?? null,
    stopSequences: options.stopSequences ?? null,
    seed: options.seed ?? null,
  };
  return sha256(JSON.stringify(material)).slice(0, 32);
}

export function estimateCost(model: ModelInfo | undefined, usage: Usage): number {
  if (!model) return 0;
  const totalInput = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const long = model.longContext && totalInput > model.longContext.thresholdTokens ? model.longContext : undefined;
  const inputRate = long ? long.inputUsdPerM : model.inputUsdPerM;
  const outputRate = long ? long.outputUsdPerM : model.outputUsdPerM;
  const cost =
    (usage.inputTokens * inputRate +
      usage.outputTokens * outputRate +
      usage.cacheReadTokens * model.cacheReadUsdPerM +
      usage.cacheWriteTokens * model.cacheWriteUsdPerM) /
    1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
