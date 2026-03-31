/**
 * OpenAI-compatible API provider
 *
 * Works with any OpenAI-compatible API (Kimi, DeepSeek, OpenAI, Ollama, etc.)
 * Uses raw fetch + SSE parsing to avoid extra dependencies.
 */

import type {
  LLMProvider,
  ProviderOptions,
  StreamEvent,
  ToolDefinition,
} from "../types.js";
import { zodToJsonSchema } from "../utils/schema.js";

export interface OpenAIProviderConfig {
  apiKey: string;
  baseURL: string;
}

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private apiKey: string;
  private baseURL: string;

  constructor(config: OpenAIProviderConfig) {
    this.apiKey = config.apiKey;
    // Remove trailing slash
    this.baseURL = config.baseURL.replace(/\/+$/, "");
  }

  async *stream(options: ProviderOptions): AsyncIterable<StreamEvent> {
    const tools = options.tools.map((t) => this.convertTool(t));

    // Build messages in OpenAI format
    const messages: any[] = [
      { role: "system", content: options.systemPrompt },
    ];

    for (const m of options.messages) {
      if (typeof m.content === "string") {
        messages.push({ role: m.role, content: m.content });
      } else {
        // Convert content blocks to OpenAI format
        const blocks = m.content as any[];

        if (m.role === "assistant") {
          // Assistant message: may contain text + tool_calls + thinking
          let textContent = "";
          let reasoningContent = "";
          const toolCalls: any[] = [];
          let toolCallIndex = 0;

          for (const block of blocks) {
            if (block.type === "text") {
              textContent += block.text;
            } else if (block.type === "tool_use") {
              toolCalls.push({
                id: block.id,
                type: "function",
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
                index: toolCallIndex++,
              });
            } else if (block.type === "thinking") {
              reasoningContent += block.thinking;
            }
          }

          const msg: any = { role: "assistant" };
          if (textContent) msg.content = textContent;
          if (toolCalls.length > 0) msg.tool_calls = toolCalls;
          if (!textContent && toolCalls.length === 0) msg.content = "";
          // Kimi K2.5 and similar models require reasoning_content in assistant
          // messages when thinking/reasoning is enabled
          if (reasoningContent) msg.reasoning_content = reasoningContent;
          messages.push(msg);
        } else if (m.role === "user") {
          // User message: may contain tool_result blocks
          for (const block of blocks) {
            if (block.type === "tool_result") {
              messages.push({
                role: "tool",
                tool_call_id: block.tool_use_id,
                content: block.content,
              });
            } else if (block.type === "text") {
              messages.push({ role: "user", content: block.text });
            }
          }
        }
      }
    }

    const body: any = {
      model: options.model,
      messages,
      stream: true,
      max_tokens: options.maxTokens,
    };

    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield { type: "error", error: `HTTP ${response.status}: ${errorText}` };
        return;
      }

      if (!response.body) {
        yield { type: "error", error: "No response body" };
        return;
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Track active tool calls by index
      const activeToolCalls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") {
            if (trimmed === "data: [DONE]") {
              // Finalize any pending tool calls
              for (const [index, tc] of activeToolCalls) {
                yield {
                  type: "tool_use_end",
                };
              }
              activeToolCalls.clear();
              yield { type: "done" };
            }
            continue;
          }

          if (!trimmed.startsWith("data: ")) continue;

          let data: any;
          try {
            data = JSON.parse(trimmed.slice(6));
          } catch {
            continue;
          }

          const choice = data.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // Handle reasoning/thinking content (Kimi K2.5, DeepSeek, etc.)
          if (delta.reasoning_content) {
            yield { type: "thinking", text: delta.reasoning_content };
          }

          // Handle text content
          if (delta.content) {
            yield { type: "text", text: delta.content };
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;

              if (tc.id) {
                // New tool call starting
                activeToolCalls.set(idx, {
                  id: tc.id,
                  name: tc.function?.name || "",
                  arguments: tc.function?.arguments || "",
                });
                yield {
                  type: "tool_use_start",
                  toolUseId: tc.id,
                  toolName: tc.function?.name || "",
                };
              } else if (activeToolCalls.has(idx)) {
                // Continuing an existing tool call
                const existing = activeToolCalls.get(idx)!;
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                  yield {
                    type: "tool_input_delta",
                    inputDelta: tc.function.arguments,
                  };
                }
              }
            }
          }

          // Handle finish_reason
          if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
            // Finalize pending tool calls
            for (const [index, tc] of activeToolCalls) {
              yield { type: "tool_use_end" };
            }
            activeToolCalls.clear();

            if (choice.finish_reason === "stop") {
              yield { type: "done" };
            }
          }
        }
      }
    } catch (err: any) {
      yield { type: "error", error: err.message || String(err) };
    }
  }

  private convertTool(
    tool: ToolDefinition
  ): { type: "function"; function: { name: string; description: string; parameters: any } } {
    const jsonSchema = zodToJsonSchema(tool.inputSchema);
    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: jsonSchema,
      },
    };
  }
}
