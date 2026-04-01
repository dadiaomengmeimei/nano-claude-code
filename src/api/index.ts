/**
 * API provider factory
 *
 * @source ../src/services/api/claude.ts - createApiClient()
 * Original only supports Anthropic. Nano adds OpenAI-compatible support.
 */

import type { LLMProvider, NanoConfig } from "../types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAIProvider } from "./openai.js";

/**
 * Create an LLM provider based on config.
 */
export function createProvider(config: NanoConfig): LLMProvider {
  switch (config.provider) {
    case "anthropic":
      return createAnthropicProvider(config.apiKey);
    case "openai":
      return createOpenAIProvider(config.apiKey, config.baseURL);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export { createAnthropicProvider, createOpenAIProvider };
