/**
 * Tests for agentLoop.ts - the core agent loop
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../src/agentLoop.js";
import type { LLMProvider, ProviderOptions, StreamEvent, ToolDefinition, Message } from "../src/types.js";
import { z } from "zod";

// ============================================================
// Mock Provider
// ============================================================

/**
 * Creates a mock LLM provider that returns predefined responses.
 * Each call to stream() pops the next response from the queue.
 */
function createMockProvider(responses: StreamEvent[][]): LLMProvider {
  let callIndex = 0;
  return {
    name: "mock",
    stream(_options: ProviderOptions): AsyncIterable<StreamEvent> {
      const events = responses[callIndex] || [{ type: "text" as const, text: "(no more responses)" }, { type: "done" as const }];
      callIndex++;
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            async next() {
              if (i < events.length) {
                return { value: events[i++], done: false };
              }
              return { value: undefined as any, done: true };
            },
          };
        },
      };
    },
  };
}

// A simple echo tool for testing
const EchoTool: ToolDefinition = {
  name: "Echo",
  description: "Echoes the input back",
  inputSchema: z.object({ message: z.string() }),
  async call(rawInput: unknown) {
    const input = rawInput as any;
    return { output: `Echo: ${input.message}` };
  },
  formatResult(result) {
    return result.output;
  },
};

// ============================================================
// Tests
// ============================================================

describe("runAgentLoop", () => {
  it("should return messages with a simple text response", async () => {
    const provider = createMockProvider([
      [
        { type: "text", text: "Hello! " },
        { type: "text", text: "How can I help?" },
        { type: "done" },
      ],
    ]);

    const messages = await runAgentLoop({
      provider,
      tools: [],
      systemPrompt: "You are helpful.",
      model: "test",
      maxTokens: 1024,
      messages: [{ role: "user", content: "Hi" }],
      toolContext: { cwd: "/tmp" },
      permissionMode: "auto",
    });

    // Should have: user message + assistant response
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[1].role, "assistant");

    // Check assistant content
    const content = messages[1].content as any[];
    const textBlocks = content.filter((b: any) => b.type === "text");
    const fullText = textBlocks.map((b: any) => b.text).join("");
    assert.equal(fullText, "Hello! How can I help?");
  });

  it("should handle tool calls and feed results back", async () => {
    const provider = createMockProvider([
      // First response: tool call
      [
        { type: "tool_use_start", toolUseId: "tool_1", toolName: "Echo" },
        { type: "tool_input_delta", inputDelta: '{"message":"test"}' },
        { type: "tool_use_end" },
        { type: "done" },
      ],
      // Second response: final text after tool result
      [
        { type: "text", text: "The echo returned: test" },
        { type: "done" },
      ],
    ]);

    const toolCalls: string[] = [];
    const messages = await runAgentLoop({
      provider,
      tools: [EchoTool],
      systemPrompt: "You are helpful.",
      model: "test",
      maxTokens: 1024,
      messages: [{ role: "user", content: "Echo test" }],
      toolContext: { cwd: "/tmp" },
      permissionMode: "auto",
      onToolCall: (name) => toolCalls.push(name),
    });

    // Should have: user, assistant(tool_use), user(tool_result), assistant(text)
    assert.equal(messages.length, 4);
    assert.deepEqual(toolCalls, ["Echo"]);

    // Check tool result was fed back
    const toolResultMsg = messages[2];
    assert.equal(toolResultMsg.role, "user");
    const blocks = toolResultMsg.content as any[];
    assert.ok(blocks.some((b: any) => b.type === "tool_result" && b.content.includes("Echo: test")));
  });

  it("should handle unknown tool gracefully", async () => {
    const provider = createMockProvider([
      [
        { type: "tool_use_start", toolUseId: "tool_1", toolName: "NonExistent" },
        { type: "tool_input_delta", inputDelta: '{}' },
        { type: "tool_use_end" },
        { type: "done" },
      ],
      [
        { type: "text", text: "Sorry, that tool failed." },
        { type: "done" },
      ],
    ]);

    const messages = await runAgentLoop({
      provider,
      tools: [EchoTool],
      systemPrompt: "You are helpful.",
      model: "test",
      maxTokens: 1024,
      messages: [{ role: "user", content: "Use nonexistent tool" }],
      toolContext: { cwd: "/tmp" },
      permissionMode: "auto",
    });

    // Check that error was returned for unknown tool
    const toolResultMsg = messages[2];
    const blocks = toolResultMsg.content as any[];
    assert.ok(blocks.some((b: any) => b.type === "tool_result" && b.is_error && b.content.includes("Unknown tool")));
  });

  it("should respect permission denial", async () => {
    const provider = createMockProvider([
      [
        { type: "tool_use_start", toolUseId: "tool_1", toolName: "Echo" },
        { type: "tool_input_delta", inputDelta: '{"message":"test"}' },
        { type: "tool_use_end" },
        { type: "done" },
      ],
      [
        { type: "text", text: "Tool was denied." },
        { type: "done" },
      ],
    ]);

    const messages = await runAgentLoop({
      provider,
      tools: [EchoTool],
      systemPrompt: "You are helpful.",
      model: "test",
      maxTokens: 1024,
      messages: [{ role: "user", content: "Echo test" }],
      toolContext: { cwd: "/tmp" },
      permissionMode: "ask",
      askPermission: async () => false, // Always deny
    });

    // Check that denial was recorded
    const toolResultMsg = messages[2];
    const blocks = toolResultMsg.content as any[];
    assert.ok(blocks.some((b: any) => b.type === "tool_result" && b.is_error && b.content.includes("rejected")));
  });

  it("should accumulate thinking blocks", async () => {
    const provider = createMockProvider([
      [
        { type: "thinking", text: "Let me think..." },
        { type: "thinking", text: " more thinking" },
        { type: "text", text: "Here is my answer." },
        { type: "done" },
      ],
    ]);

    let thinkingOutput = "";
    const messages = await runAgentLoop({
      provider,
      tools: [],
      systemPrompt: "You are helpful.",
      model: "test",
      maxTokens: 1024,
      messages: [{ role: "user", content: "Think about this" }],
      toolContext: { cwd: "/tmp" },
      permissionMode: "auto",
      onThinking: (text) => { thinkingOutput += text; },
    });

    assert.equal(thinkingOutput, "Let me think... more thinking");

    // Check thinking block in assistant message
    const assistantContent = messages[1].content as any[];
    const thinkingBlocks = assistantContent.filter((b: any) => b.type === "thinking");
    assert.ok(thinkingBlocks.length > 0);
  });

  it("should handle API errors gracefully", async () => {
    const provider = createMockProvider([
      [
        { type: "error", error: "Rate limit exceeded" },
      ],
    ]);

    const messages = await runAgentLoop({
      provider,
      tools: [],
      systemPrompt: "You are helpful.",
      model: "test",
      maxTokens: 1024,
      messages: [{ role: "user", content: "Hi" }],
      toolContext: { cwd: "/tmp" },
      permissionMode: "auto",
    });

    // Should still return messages (with error text)
    assert.equal(messages.length, 2);
    const content = messages[1].content as any[];
    assert.ok(content.some((b: any) => b.type === "text" && b.text.includes("Error")));
  });
});
