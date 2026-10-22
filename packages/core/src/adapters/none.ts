import { ApexError } from '../util/errors.js';
import { estimateTokens } from '../context/tokens.js';
import type { CountTokensInput, GenerateOptions, GenerateResult, ModelAdapter } from './types.js';

/**
 * The adapter used when no API key is configured: every model call fails with a clear
 * message, while everything that needs no model (assembly, lint, accept, chronicle apply,
 * prepare/submit) keeps working. Headless mode runs on this adapter by default.
 */
export class NoModelAdapter implements ModelAdapter {
  readonly provider = 'replay' as const;
  readonly exactTokenCounts = false;

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    throw new ApexError(
      'ADAPTER_ERROR',
      `No model is configured for ${options.task}. Set ANTHROPIC_API_KEY, or use task_prepare / task_submit so the client generates the output.`,
      { task: options.task },
    );
  }

  async countTokens(input: CountTokensInput): Promise<number> {
    return estimateTokens([input.text ?? '', ...(input.system ?? []).map((s) => s.text), ...(input.messages ?? []).map((m) => m.content)].join('\n'));
  }
}
