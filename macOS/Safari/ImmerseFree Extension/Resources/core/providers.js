import "./provider-core.js";

export const {
  buildTranslationPrompt,
  completeText,
  getGeminiKeyStatus,
  normalizeContext,
  parseTranslationArray,
  translateWithAntigravity,
  translateWithCustomApi,
  translateWithGemini,
  translateWithOpenCode,
  listCustomApiModels
} = globalThis.ImmerseFreeProviderCore;
