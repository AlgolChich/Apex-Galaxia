import type { ModelInfo } from './types.js';

/**
 * Known models with context windows and list prices. Verified against the Claude API
 * reference bundled with Claude Code on 2026-10-22 (cached 2026-10-06). Prices change: the
 * user config can override any entry, and `estimateCost` is a planning aid, not an invoice.
 */
const claude = (
  id: string,
  displayName: string,
  input: number,
  output: number,
  cacheRead: number,
  extra: Partial<ModelInfo> = {},
): ModelInfo => ({
  id,
  provider: 'anthropic',
  displayName,
  contextWindow: 1_000_000,
  maxOutput: 128_000,
  inputUsdPerM: input,
  outputUsdPerM: output,
  cacheReadUsdPerM: cacheRead,
  cacheWriteUsdPerM: input * 1.25,
  supportsTemperature: false,
  supportsEffort: true,
  supportsThinking: true,
  supportsStructuredOutput: true,
  ...extra,
});

export const DEFAULT_MODELS: ModelInfo[] = [
  claude('claude-fable-5-1', 'Claude Fable 5.1', 10, 50, 0.25),
  claude('claude-opus-5-5', 'Claude Opus 5.5', 4, 20, 0.2),
  claude('claude-opus-5', 'Claude Opus 5', 5, 25, 0.5),
  claude('claude-sonnet-5-5', 'Claude Sonnet 5.5', 2, 10, 0.2),
  claude('claude-sonnet-5', 'Claude Sonnet 5', 2, 10, 0.2),
  claude('claude-haiku-5-5', 'Claude Haiku 5.5', 0.1, 0.5, 0.01, {
    longContext: { thresholdTokens: 100_000, inputUsdPerM: 0.5, outputUsdPerM: 2.5 },
  }),
];

export class ModelRegistry {
  private readonly models = new Map<string, ModelInfo>();

  constructor(models: ModelInfo[] = DEFAULT_MODELS) {
    for (const m of models) this.models.set(m.id, m);
  }

  get(id: string): ModelInfo | undefined {
    return this.models.get(id);
  }

  require(id: string): ModelInfo {
    const m = this.models.get(id);
    if (!m) {
      throw new Error(`Unknown model ${id}; add it to models in ~/.apex-galaxia/config.yaml`);
    }
    return m;
  }

  add(model: ModelInfo): void {
    this.models.set(model.id, model);
  }

  list(): ModelInfo[] {
    return [...this.models.values()];
  }
}
