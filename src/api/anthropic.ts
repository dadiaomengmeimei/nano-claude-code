/**
 * Anthropic API provider - handles streaming communication with Claude
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ProviderOptions,
  StreamEvent,
  ToolDefinition,
} from "../types.js";
import { zodToJsonSchema } from "../utils/schema.js";

export class AnthropicProvider implements LLMProvider {
  name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async *stream(options: ProviderOptions): AsyncIterable<StreamEvent> {
    const tools = options.tools.map((t) => this.convertTool(t));

    // Convert messages to Anthropic format, filtering out thinking blocks
    // (thinking blocks are output-only and should not be sent back)
    const messages: Anthropic.Messages.MessageParam[] = options.messages.map((m) => {
      if (typeof m.content === "string") {
        return { role: m.role as "user" | "assistant", content: m.content };
      }
      // Convert content blocks to Anthropic format
      const content = (m.content as any[])
        .filter((block) => block.type !== "thinking") // Filter out thinking blocks
        .map((block) => {
          if (block.type === "tool_result") {
            return {
              type: "tool_result" as const,
              tool_use_id: block.tool_use_id,
              content: block.content,
              ...(block.is_error ? { is_error: true as const } : {}),
            };
          }
          if (block.type === "tool_use") {
            return {
              type: "tool_use" as const,
              id: block.id,
              name: block.name,
              input: block.input,
            };
          }
          return { type: "text" as const, text: block.text || "" };
        });
      return { role: m.role as "user" | "assistant", content };
    });

    try {
      const stream = this.client.messages.stream({
        model: options.model,
        max_tokens: options.maxTokens,
        system: options.systemPrompt,
        messages,
        tools: tools.length > 0 ? tools : undefined,
      });

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          const block = event.content_block as any;
          if (block.type === "tool_use") {
            yield {
              type: "tool_use_start",
              toolUseId: block.id,
              toolName: block.name,
            };
          } else if (block.type === "thinking") {
            yield { type: "thinking", text: "" };
          }
        } else if (event.type === "content_block_delta") {
          const delta = event.delta as any;
          if (delta.type === "text_delta") {
            yield { type: "text", text: delta.text };
          } else if (delta.type === "input_json_delta") {
            yield { type: "tool_input_delta", inputDelta: delta.partial_json };
          } else if (delta.type === "thinking_delta") {
            yield { type: "thinking", text: delta.thinking };
          }
        } else if (event.type === "content_block_stop") {
          yield { type: "tool_use_end" };
        } else if (event.type === "message_stop") {
          yield { type: "done" };
        }
      }
    } catch (err: any) {
      yield { type: "error", error: err.message || String(err) };
    }
  }

  private convertTool(tool: ToolDefinition): Anthropic.Messages.Tool {
    const jsonSchema = zodToJsonSchema(tool.inputSchema);
    return {
      name: tool.name,
      description: tool.description,
      input_schema: jsonSchema as Anthropic.Messages.Tool.InputSchema,
    };
  }
}
