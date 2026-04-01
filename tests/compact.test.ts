/**
 * Tests for compact.ts - conversation summarization
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens } from "../src/compact.js";
import type { Message } from "../src/types.js";

describe("estimateTokens", () => {
  it("should estimate tokens for simple string messages", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello world" }, // 11 chars => ~3 tokens
    ];
    const tokens = estimateTokens(messages);
    assert.equal(tokens, Math.ceil(11 / 4));
  });

  it("should estimate tokens for multiple messages", () => {
    const messages: Message[] = [
      { role: "user", content: "Hello" },       // 5 chars
      { role: "assistant", content: "Hi there" }, // 8 chars
    ];
    const tokens = estimateTokens(messages);
    assert.equal(tokens, Math.ceil(13 / 4));
  });

  it("should estimate tokens for content block messages", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me help" },  // 11 chars
          { type: "tool_use", id: "1", name: "Bash", input: { command: "ls" } }, // ~20 chars
        ],
      },
    ];
    const tokens = estimateTokens(messages);
    assert.ok(tokens > 0);
  });

  it("should return 0 for empty messages", () => {
    const tokens = estimateTokens([]);
    assert.equal(tokens, 0);
  });

  it("should handle tool_result blocks", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "1",
            content: "file contents here",
          },
        ],
      },
    ];
    const tokens = estimateTokens(messages);
    assert.equal(tokens, Math.ceil(18 / 4)); // "file contents here" = 18 chars
  });

  it("should handle thinking blocks", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Let me think about this..." },
        ],
      },
    ];
    const tokens = estimateTokens(messages);
    assert.ok(tokens > 0);
  });
});
