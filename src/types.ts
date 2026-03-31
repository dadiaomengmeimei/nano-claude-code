/**
 * Core type definitions for nano-claude-code
 */

import { z } from "zod";

// ============================================================
// Message Types
// ============================================================

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// ============================================================
// Tool Types
// ============================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  call(input: any, context: ToolContext): Promise<ToolResult>;
  /** Convert tool output to a string for the model */
  formatResult(result: ToolResult): string;
}

export interface ToolContext {
  cwd: string;
  abortSignal?: AbortSignal;
}

export interface ToolResult {
  output: string;
  isError?: boolean;
}

// ============================================================
// Provider Types
// ============================================================

export interface StreamEvent {
  type: "text" | "tool_use_start" | "tool_input_delta" | "tool_use_end" | "thinking" | "done" | "error";
  text?: string;
  toolUseId?: string;
  toolName?: string;
  inputDelta?: string;
  error?: string;
}

export interface ProviderOptions {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  tools: ToolDefinition[];
  messages: Message[];
  signal?: AbortSignal;
}

export interface LLMProvider {
  name: string;
  stream(options: ProviderOptions): AsyncIterable<StreamEvent>;
}

// ============================================================
// Config Types
// ============================================================

export interface NanoConfig {
  provider: "anthropic" | "openai";
  model: string;
  maxTokens: number;
  apiKey: string;
  /** Base URL for OpenAI-compatible APIs (e.g. https://api.moonshot.cn/v1) */
  baseURL: string;
  /** Permission mode: 'ask' prompts user, 'auto' allows all */
  permissionMode: "ask" | "auto";
}
