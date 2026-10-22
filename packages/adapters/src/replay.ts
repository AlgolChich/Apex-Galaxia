import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ApexError,
  ModelRegistry,
  emptyUsage,
  estimateCost,
  estimateTokens,
  promptHash,
  type CountTokensInput,
  type GenerateOptions,
  type GenerateResult,
  type ModelAdapter,
  type Usage,
} from '@apex-galaxia/core';

export interface CassetteEntry {
  task: string;
  model: string;
  text: string;
  usage: Usage;
  stopReason: GenerateResult['stopReason'];
  recordedAt: string;
  /** First 120 characters of the user turn, so a human can tell entries apart. */
  preview: string;
}

export interface Cassette {
  version: 1;
  entries: Record<string, CassetteEntry>;
}

export type Responder = (options: GenerateOptions) => string | Promise<string>;

export interface ReplayAdapterOptions {
  /** JSON file holding recorded responses; omitted means in-memory only. */
  cassetteFile?: string;
  /** `replay`: only recorded answers. `record`: call `inner` and save. `auto`: replay if present, else record. */
  mode?: 'replay' | 'record' | 'auto';
  /** The real adapter used in record mode. */
  inner?: ModelAdapter;
  /** A scripted answer for tests when nothing is recorded. */
  responder?: Responder;
  registry?: ModelRegistry;
}

/**
 * Record-and-replay adapter (Section 12.2: no network in unit tests). Responses are keyed by
 * the prompt hash, so a changed prompt is a cache miss, which is what a snapshot should do.
 */
export class ReplayAdapter implements ModelAdapter {
  readonly provider = 'replay' as const;
  readonly exactTokenCounts = false;
  private cassette: Cassette = { version: 1, entries: {} };
  private loaded = false;
  private readonly registry: ModelRegistry;
  readonly calls: GenerateOptions[] = [];

  constructor(private readonly options: ReplayAdapterOptions = {}) {
    this.registry = options.registry ?? new ModelRegistry();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.options.cassetteFile) return;
    try {
      const text = await fs.readFile(this.options.cassetteFile, 'utf8');
      const parsed = JSON.parse(text) as Cassette;
      if (parsed.version === 1 && parsed.entries) this.cassette = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async save(): Promise<void> {
    if (!this.options.cassetteFile) return;
    await fs.mkdir(path.dirname(this.options.cassetteFile), { recursive: true });
    await fs.writeFile(this.options.cassetteFile, JSON.stringify(this.cassette, null, 2) + '\n', 'utf8');
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    await this.load();
    this.calls.push(options);
    const hash = promptHash(options);
    const started = Date.now();
    const mode = this.options.mode ?? 'auto';
    const recorded = this.cassette.entries[hash];

    if (recorded && mode !== 'record') {
      return this.emit(options, recorded, hash, started, true);
    }
    if (mode === 'replay') {
      if (this.options.responder) {
        const text = await this.options.responder(options);
        return this.emit(options, this.synthesize(options, text), hash, started, true);
      }
      throw new ApexError('ADAPTER_ERROR', `No recorded response for ${options.task} (hash ${hash}); record a cassette first`, { task: options.task, hash });
    }
    if (this.options.inner) {
      const result = await this.options.inner.generate(options);
      const entry: CassetteEntry = {
        task: options.task,
        model: result.model,
        text: result.text,
        usage: result.usage,
        stopReason: result.stopReason,
        recordedAt: new Date().toISOString(),
        preview: options.messages[options.messages.length - 1]?.content.slice(0, 120) ?? '',
      };
      this.cassette.entries[hash] = entry;
      await this.save();
      return { ...result, replay: false };
    }
    if (this.options.responder) {
      const text = await this.options.responder(options);
      const entry = this.synthesize(options, text);
      this.cassette.entries[hash] = entry;
      await this.save();
      return this.emit(options, entry, hash, started, true);
    }
    throw new ApexError('ADAPTER_ERROR', `Replay adapter has nothing for ${options.task}: no cassette entry, no inner adapter, no responder`, { task: options.task });
  }

  private synthesize(options: GenerateOptions, text: string): CassetteEntry {
    const input = estimateTokens(options.system.map((s) => s.text).join('\n') + options.messages.map((m) => m.content).join('\n'));
    return {
      task: options.task,
      model: options.model,
      text,
      usage: { ...emptyUsage(), inputTokens: input, outputTokens: estimateTokens(text) },
      stopReason: 'end',
      recordedAt: new Date().toISOString(),
      preview: options.messages[options.messages.length - 1]?.content.slice(0, 120) ?? '',
    };
  }

  private emit(options: GenerateOptions, entry: CassetteEntry, hash: string, started: number, replay: boolean): GenerateResult {
    if (options.onDelta) {
      const chunk = 80;
      for (let i = 0; i < entry.text.length; i += chunk) options.onDelta(entry.text.slice(i, i + chunk));
    }
    const result: GenerateResult = {
      text: entry.text,
      usage: entry.usage,
      model: entry.model,
      provider: 'replay',
      stopReason: entry.stopReason,
      latencyMs: Date.now() - started,
      costUsd: estimateCost(this.registry.get(entry.model), entry.usage),
      promptHash: hash,
      replay,
    };
    if (options.jsonSchema) {
      try {
        result.json = JSON.parse(entry.text);
      } catch {
        // the pipeline's contract check reports it
      }
    }
    return result;
  }

  async countTokens(input: CountTokensInput): Promise<number> {
    if (this.options.inner?.exactTokenCounts) return this.options.inner.countTokens(input);
    const text = [input.text ?? '', ...(input.system ?? []).map((s) => s.text), ...(input.messages ?? []).map((m) => m.content)].join('\n');
    return estimateTokens(text);
  }
}
