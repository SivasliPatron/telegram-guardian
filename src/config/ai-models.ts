export const DEFAULT_AI_MODEL = 'gemini-3.1-flash-lite';

export const DEFAULT_AI_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
] as const;

const GEMINI_MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/i;
const MAXIMUM_FALLBACK_MODELS = 4;

export function parseGeminiModelCandidates(primaryModel: string, fallbackModels: string): string[] {
  const candidates = [primaryModel, ...fallbackModels.split(',')]
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(candidates)];
}

export function isValidGeminiFallbackList(value: string): boolean {
  const models = value
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return (
    models.length <= MAXIMUM_FALLBACK_MODELS &&
    models.every((model) => GEMINI_MODEL_ID_PATTERN.test(model))
  );
}
