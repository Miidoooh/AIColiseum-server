/** Contestants are anonymous to each other: strip model and lab names from speech before delivery. */
const IDENTITY =
  /\b(claude|anthropic|chat\s?gpt|gpt[-\s]?\d+(?:\.\d+)?[a-z-]*|openai|gemini|gemma|deepmind|google|bard|grok|xai|x\.ai|deepseek|qwen|alibaba|mistral|mixtral|kimi|moonshot|glm|zhipu|llama|meta\s?ai|minimax)\b/gi;

export function redactIdentity(text: string): string {
  return text.replace(IDENTITY, '[redacted]');
}
