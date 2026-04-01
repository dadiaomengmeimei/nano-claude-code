/**
 * Anthropic API Provider - Direct Anthropic SDK integration
 *
 * @source ../src/services/api/claude.ts - createApiClient(), streamMessage()
 *
 * Original design:
 * - Uses Anthropic SDK with streaming (messages.stream())
 * - Implements prompt caching via cache_control boundaries
 * - Handles 413 (prompt_too_long) with reactive compact
 * - Handles 529 (overloaded) with retry
 * - Handles max_tokens recovery
 * - Supports beta features (extended thinking, token counting)
 * - Converts tools to Anthropic format with cache_control
 *
 * Nano keeps: streaming via SDK, tool conversion.
 * Removed: prompt caching, 413/529 recovery, beta features.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LLMProvider, ProviderOptions, StreamEvent, ToolDefinition } from "../types.js";

/**
 * Convert nano ToolDefinition to Anthropic API tool format.
 *
 * @source ../src/services/api/claude.ts - tools are converted with
 * cache_control boundaries for prompt caching optimization.
 * Nano does a simple conversion without cache_control.
 */
function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  const jsonSchema = zodToJsonSchema(tool.inputSchema, { target: "openApi3" });
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object" as const,
      properties: (jsonSchema as any).properties || {},
      required: (jsonSchema as any).required || [],
    },
  };
}

/**
 * Create an Anthropic provider.
 *
 * @source ../src/services/api/claude.ts - createApiClient()
 * Original creates a singleton client with retry config.
 */
export function createAnthropicProvider(apiKey: string): LLMProvider {
  const client = new Anthropic({ apiKey });

  return {
    name: "anthropic",

    /**
     * Stream a message using the Anthropic SDK.
     *
     * @source ../src/services/api/claude.ts - streamMessage()
     * Original uses messages.stream() with event handlers for:
     * - message_start, content_block_start, content_block_delta,
     *   content_block_stop, message_stop, error
     * Plus special handling for tool_use blocks and thinking blocks.
     * Nano maps the same events to our StreamEvent type.
     */
    async *stream(options: ProviderOptions): AsyncIterable<StreamEvent> {
      const tools = options.tools.map(toAnthropicTool);

      try {
        const stream = client.messages.stream({
          model: options.model,
          max_tokens: options.maxTokens,
          system: options.systemPrompt,
          messages: options.messages.map((m) => ({
            role: m.role,
            content: m.content as any,
          })),
          tools: tools.length > 0 ? tools : undefined,
        });

        // @source claude.ts - event handling via stream.on()
        for await (const event of stream) {
          switch (event.type) {
            case "content_block_start":
              if (event.content_block.type === "tool_use") {
                yield {
                  type: "tool_use_start",
                  toolUseId: event.content_block.id,
                  toolName: event.content_block.name,
                };
              } else if (event.content_block.type === "thinking") {
                yield { type: "thinking", text: "" };
              }
              break;

            case "content_block_delta":
              if (event.delta.type === "text_delta") {
                yield { type: "text", text: event.delta.text };
              } else if (event.delta.type === "input_json_delta") {
                yield {
                  type: "tool_input_delta",
                  inputDelta: event.delta.partial_json,
                };
              } else if (event.delta.type === "thinking_delta") {
                yield { type: "thinking", text: (event.delta as any).thinking };
              }
              break;

            case "content_block_stop":
              // Check if the stopped block was a tool_use
              const msg = (stream as any).currentMessage;
              if (msg?.content?.[event.index]?.type === "tool_use") {
                yield { type: "tool_use_end" };
              }
              break;

            case "message_stop":
              yield { type: "done" };
              break;
          }
        }
      } catch (err: any) {
        yield { type: "error", error: err.message };
      }
    },
  };
}
