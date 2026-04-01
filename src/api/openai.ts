/**
 * OpenAI-compatible API Provider
 *
 * @source Not directly from Claude Code (which only supports Anthropic API)
 * This is a nano-specific addition to support OpenAI-compatible APIs
 * (OpenAI, Moonshot, DeepSeek, local LLMs via Ollama/vLLM, etc.)
 *
 * Design follows the same streaming pattern as the Anthropic provider,
 * mapping OpenAI's SSE events to our unified StreamEvent type.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import type { LLMProvider, ProviderOptions, StreamEvent, ToolDefinition } from "../types.js";

/**
 * Convert nano ToolDefinition to OpenAI function calling format.
 */
function toOpenAITool(tool: ToolDefinition) {
  const jsonSchema = zodToJsonSchema(tool.inputSchema, { target: "openApi3" });
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: (jsonSchema as any).properties || {},
        required: (jsonSchema as any).required || [],
      },
    },
  };
}

/**
 * Create an OpenAI-compatible provider.
 */
export function createOpenAIProvider(apiKey: string, baseURL: string): LLMProvider {
  return {
    name: "openai",

    async *stream(options: ProviderOptions): AsyncIterable<StreamEvent> {
      const tools = options.tools.map(toOpenAITool);

      const body: Record<string, unknown> = {
        model: options.model,
        max_tokens: options.maxTokens,
        stream: true,
        messages: [
          { role: "system", content: options.systemPrompt },
          ...options.messages.map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          })),
        ],
      };

      if (tools.length > 0) {
        body.tools = tools;
      }

      try {
        const response = await fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: options.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          yield { type: "error", error: `HTTP ${response.status}: ${errorText}` };
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          yield { type: "error", error: "No response body" };
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              // Flush any pending tool calls
              for (const [, tc] of toolCallBuffers) {
                yield { type: "tool_use_end" };
              }
              yield { type: "done" };
              continue;
            }

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;
              if (!delta) continue;

              // Text content
              if (delta.content) {
                yield { type: "text", text: delta.content };
              }

              // Tool calls
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;

                  if (tc.id) {
                    // New tool call
                    toolCallBuffers.set(idx, {
                      id: tc.id,
                      name: tc.function?.name || "",
                      args: tc.function?.arguments || "",
                    });
                    yield {
                      type: "tool_use_start",
                      toolUseId: tc.id,
                      toolName: tc.function?.name || "",
                    };
                  } else if (tc.function?.arguments) {
                    // Continuation of arguments
                    const existing = toolCallBuffers.get(idx);
                    if (existing) {
                      existing.args += tc.function.arguments;
                    }
                    yield {
                      type: "tool_input_delta",
                      inputDelta: tc.function.arguments,
                    };
                  }
                }
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } catch (err: any) {
        yield { type: "error", error: err.message };
      }
    },
  };
}
