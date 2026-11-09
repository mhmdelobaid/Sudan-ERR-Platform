import { getAiModel, aiProvider, AI_NOT_CONFIGURED } from '../ai/model';

export function isRetryableGeminiError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\[503|\[529|\[429|503 Service|429 Too Many|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|try again later|overloaded|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    m
  );
}

export type GeminiParseSnipsResilientConfig = {
  logPrefix: string;
  primaryModelId: string;
  fallbackModelId: string;
  temperatureDefault: number;
};

function getModelWithId(
  _apiKey: string,
  modelId: string,
  systemInstruction: string,
  maxOutputTokens: number,
  temperatureDefault: number,
  opts?: { temperature?: number }
) {
  // Claude when its key is set, otherwise Gemini (lib/ai/model.ts)
  return getAiModel({
    model: modelId,
    systemInstruction,
    temperature: opts?.temperature ?? temperatureDefault,
    json: true,
    maxOutputTokens,
  });
}

/**
 * Retries transient API errors on the primary model, then optionally uses a larger
 * fallback model if primary is a lite tier.
 */
export function createGeminiParseSnipsResilient(config: GeminiParseSnipsResilientConfig) {
  const { logPrefix, primaryModelId, fallbackModelId, temperatureDefault } = config;

  async function generateContentResilient(
    systemInstruction: string,
    maxOutputTokens: number,
    opts: { temperature?: number } | undefined,
    content: any
  ) {
    if (!aiProvider()) throw new Error(AI_NOT_CONFIGURED);
    const apiKey = '';

    const primaryAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt < primaryAttempts; attempt++) {
      try {
        const model = getModelWithId(
          apiKey,
          primaryModelId,
          systemInstruction,
          maxOutputTokens,
          temperatureDefault,
          opts
        );
        return await model.generateContent(content as any);
      } catch (e) {
        lastErr = e;
        if (!isRetryableGeminiError(e)) throw e;
        if (attempt < primaryAttempts - 1) {
          const delayMs = 500 * Math.pow(2, attempt);
          console.warn(`${logPrefix} RETRY`, {
            model: primaryModelId,
            attempt: attempt + 1,
            delayMs,
          });
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    const tryFallback =
      aiProvider() === 'gemini' && primaryModelId !== fallbackModelId && primaryModelId.includes('flash-lite');
    if (tryFallback) {
      console.warn(`${logPrefix} FALLBACK_MODEL`, {
        from: primaryModelId,
        to: fallbackModelId,
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const model = getModelWithId(
            apiKey,
            fallbackModelId,
            systemInstruction,
            maxOutputTokens,
            temperatureDefault,
            opts
          );
          return await model.generateContent(content as any);
        } catch (e) {
          lastErr = e;
          if (!isRetryableGeminiError(e)) throw e;
          if (attempt < 1) {
            const delayMs = 800;
            console.warn(`${logPrefix} RETRY`, {
              model: fallbackModelId,
              attempt: attempt + 1,
              delayMs,
            });
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }
    }

    if (lastErr instanceof Error) throw lastErr;
    throw new Error(String(lastErr));
  }

  return { generateContentResilient };
}
