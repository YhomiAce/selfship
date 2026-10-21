import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { type Diagnosis, DiagnosisSchema } from '@selfship/shared';
import { SYSTEM_PROMPT } from './prompt';

/** A diagnosis with what it cost. */
export interface ModelAnswer {
  diagnosis: Diagnosis;
  /** Model that answered (a fallback model if the first one declined). */
  model: string;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

/** Anything that turns a failure description into a diagnosis (Claude, or a fake in tests). */
export interface DiagnosisModel {
  diagnose(userMessage: string): Promise<ModelAnswer>;
}

/** The model gave no usable diagnosis (declined, cut off, or malformed). */
export class NoDiagnosisError extends Error {
  override name = 'NoDiagnosisError';
}

/** Options for {@link ClaudeDiagnosisModel}. */
export interface ClaudeOptions {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Retry declined requests on Anthropic's recommended fallback model (server-side). */
  fallbacks: boolean;
}

/**
 * Build Doctor on the Claude API: one structured-output request per
 * diagnosis. The system prompt is stable and marked for prompt caching; the
 * response is validated against {@link DiagnosisSchema}.
 */
export class ClaudeDiagnosisModel implements DiagnosisModel {
  /**
   * @param client - Anthropic SDK client
   * @param options - Model, effort and fallback settings
   */
  constructor(
    private readonly client: Anthropic,
    private readonly options: ClaudeOptions,
  ) {}

  /**
   * Asks Claude for a diagnosis.
   *
   * @param userMessage - Redacted failure description (see buildUserMessage)
   * @returns Diagnosis and usage
   * @throws {NoDiagnosisError} On a refusal, a cut-off answer or an unparseable one
   * @throws {Anthropic.APIError} On API failures (the job records them)
   */
  async diagnose(userMessage: string): Promise<ModelAnswer> {
    const response = await this.client.beta.messages.parse({
      model: this.options.model,
      max_tokens: 16000,
      ...(this.options.fallbacks
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {}),
      output_config: {
        effort: this.options.effort,
        format: betaZodOutputFormat(DiagnosisSchema),
      },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage }],
    });

    if (response.stop_reason === 'refusal') {
      throw new NoDiagnosisError('The AI model declined to analyse this build log.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new NoDiagnosisError('The diagnosis was cut off before it was complete.');
    }
    const diagnosis = response.parsed_output;
    if (!diagnosis) throw new NoDiagnosisError('The AI model returned an unreadable diagnosis.');
    return {
      diagnosis,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}
