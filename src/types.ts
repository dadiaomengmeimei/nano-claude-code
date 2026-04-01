/**
 * Core type definitions for nano-claude-code
 *
 * @source ../src/Tool.ts — Tool, ToolResult, ToolUseContext, buildTool
 * @source ../src/utils/messages.ts — Message types
 *
 * Nano simplification:
 * - Tool interface reduced from ~60 methods to the essential 7
 * - ToolUseContext reduced from ~40 fields to 2 (cwd, abortSignal)
 * - Message types simplified to Anthropic API format
 * - Removed: React rendering, MCP, Skills, permissions, analytics
 */

import { z } from "zod";

// ============================================================
// Message Types (from ../src/utils/messages.ts)
// ============================================================

/** @source Anthropic SDK: TextBlockParam */
export interface TextBlock {
  type: "text";
  text: string;
}

/** @source Anthropic SDK: ToolUseBlockParam */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** @source Anthropic SDK: ToolResultBlockParam */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** @source Anthropic SDK: ThinkingBlockParam */
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

/** @source Anthropic SDK: MessageParam */
export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// ============================================================
// Tool Types (from ../src/Tool.ts)
// ============================================================

/**
 * Simplified ToolResult.
 *
 * @source ../src/Tool.ts — ToolResult<T>
 * Original has { data: T, newMessages?, contextModifier? }.
 * Nano flattens to { output: string, isError? } for simplicity.
 */
export interface ToolResult {
  output: string;
  isError?: boolean;
}

/**
 * Simplified ToolUseContext.
 *
 * @source ../src/Tool.ts — ToolUseContext
 * Original has ~40 fields (abortController, readFileState, getAppState,
 * setAppState, MCP clients, file history, attribution, etc.).
 * Nano keeps only the essentials.
 */
export interface ToolUseContext {
  cwd: string;
  abortSignal?: AbortSignal;
}

/** Alias for convenience in tool files */
export type ToolContext = ToolUseContext;

/**
 * Tool definition — the core abstraction.
 *
 * @source ../src/Tool.ts — Tool<Input, Output, P>
 * Original has ~60 methods (call, description, prompt, checkPermissions,
 * validateInput, isReadOnly, isConcurrencySafe, renderToolUseMessage, etc.).
 * Nano keeps the 5 essential ones.
 *
 * Key design decisions preserved from original:
 * - inputSchema uses Zod (converted to JSON Schema for API)
 * - call() is async and returns ToolResult
 * - name is readonly
 * - isReadOnly determines permission behavior
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<any>;

  /** @source Tool.call() — execute the tool */
  call(input: any, context: ToolUseContext): Promise<ToolResult>;

  /** @source Tool.isReadOnly() — determines if permission check is needed */
  isReadOnly(): boolean;

  /**
   * Convert tool output to a string for the model.
   * @source Tool.mapToolResultToToolResultBlockParam()
   */
  formatResult(result: ToolResult): string;
}

/**
 * A collection of tools.
 * @source ../src/Tool.ts — export type Tools = readonly Tool[]
 */
export type Tools = readonly ToolDefinition[];

// ============================================================
// Provider Types (streaming abstraction)
// ============================================================

/**
 * Unified stream event type.
 *
 * @source ../src/query.ts — StreamEvent
 * Original uses Anthropic SDK's raw event types.
 * Nano normalizes to a simple discriminated union.
 */
export interface StreamEvent {
  type:
    | "text"
    | "tool_use_start"
    | "tool_input_delta"
    | "tool_use_end"
    | "thinking"
    | "done"
    | "error";
  text?: string;
  toolUseId?: string;
  toolName?: string;
  inputDelta?: string;
  error?: string;
}

/**
 * Provider options for streaming.
 *
 * @source ../src/services/api/claude.ts — API call parameters
 */
export interface ProviderOptions {
  model: string;
  maxTokens: number;
  systemPrompt: string;
  tools: ToolDefinition[];
  messages: Message[];
  signal?: AbortSignal;
}

/**
 * LLM Provider abstraction.
 *
 * @source ../src/services/api/claude.ts
 * Original uses Anthropic SDK directly with cache_control, prompt caching, etc.
 * Nano abstracts to a simple stream interface supporting multiple providers.
 */
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
