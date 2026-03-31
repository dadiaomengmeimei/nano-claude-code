/**
 * Configuration management
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { NanoConfig } from "../types.js";

const CONFIG_FILE = ".nano-claude.json";

const DEFAULT_CONFIG: NanoConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  maxTokens: 16384,
  apiKey: "",
  baseURL: "https://api.openai.com/v1",
  permissionMode: "ask",
};

/**
 * Load configuration from environment variables and config file
 */
export async function loadConfig(): Promise<NanoConfig> {
  let fileConfig: Partial<NanoConfig> = {};

  // Try to load from home directory config file
  try {
    const configPath = join(homedir(), CONFIG_FILE);
    const content = await readFile(configPath, "utf-8");
    fileConfig = JSON.parse(content);
  } catch {
    // No config file, that's fine
  }

  // Environment variables take precedence
  const config: NanoConfig = {
    provider:
      (process.env.NANO_PROVIDER as NanoConfig["provider"]) ||
      fileConfig.provider ||
      DEFAULT_CONFIG.provider,
    model:
      process.env.NANO_MODEL ||
      fileConfig.model ||
      DEFAULT_CONFIG.model,
    maxTokens:
      Number(process.env.NANO_MAX_TOKENS) ||
      fileConfig.maxTokens ||
      DEFAULT_CONFIG.maxTokens,
    apiKey:
      process.env.NANO_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      fileConfig.apiKey ||
      DEFAULT_CONFIG.apiKey,
    baseURL:
      process.env.NANO_BASE_URL ||
      fileConfig.baseURL ||
      DEFAULT_CONFIG.baseURL,
    permissionMode:
      (process.env.NANO_PERMISSION_MODE as NanoConfig["permissionMode"]) ||
      fileConfig.permissionMode ||
      DEFAULT_CONFIG.permissionMode,
  };

  return config;
}
