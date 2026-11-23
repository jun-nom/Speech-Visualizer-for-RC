export const TEXT_MODEL_KEY = 'speechflow-text-model';
export const DEFAULT_TEXT_MODEL = 'gpt-4o';

export function textModel(value?: string | null) {
  return value === 'gpt-5.4-mini' || value === 'gpt-4o-mini' ? value : DEFAULT_TEXT_MODEL;
}

export function textCompletionBody(model: string, messages: object[], maxTokens: number, temperature: number) {
  if (model === 'gpt-5.4-mini') {
    return { model, messages, max_completion_tokens: maxTokens, reasoning_effort: 'none' };
  }
  return { model, messages, max_tokens: maxTokens, temperature };
}
