/**
 * Compact - Conversation summarization to reduce token usage
 *
 * When conversations grow long, /compact summarizes the history into a
 * concise summary, preserving key context while dramatically reducing tokens.
 * This mirrors Claude Code's conversation compaction feature.
 */

import type { Message, ContentBlock, LLMProvider } from "./types.js";

const COMPACT_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to create a concise but complete summary of the conversation so far.

Rules:
1. Preserve ALL important context: file paths, code changes made, errors encountered, decisions made
2. Preserve the user's original request/goal
3. List specific files that were read, edited, or created
4. Note any tool calls and their outcomes
5. Keep technical details (function names, variable names, error messages)
6. Be concise - remove pleasantries, redundant explanations, and verbose tool outputs
7. Output format: a single summary paragraph followed by bullet points of key actions/state

Your summary will replace the entire conversation history, so nothing important should be lost.`;

/**
 * Extract text content from a message for summarization
 */
function messageToText(msg: Message): string {
  if (typeof msg.content === "string") {
    return `[${msg.role}]: ${msg.content}`;
  }

  const parts: string[] = [];
  for (const block of msg.content as ContentBlock[]) {
    switch (block.type) {
      case "text":
        parts.push(block.text);
        break;
      case "tool_use":
        parts.push(`[Tool Call: ${block.name}(${JSON.stringify(block.input).slice(0, 200)})]`);
        break;
      case "tool_result": {
        const preview = block.content.slice(0, 300);
        parts.push(`[Tool Result${block.is_error ? " ERROR" : ""}: ${preview}]`);
        break;
      }
      case "thinking":
        // Skip thinking blocks in summary input to save tokens
        break;
    }
  }

  return `[${msg.role}]: ${parts.join("\n")}`;
}

/**
 * Estimate token count (rough: ~4 chars per token)
 */
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else {
      for (const block of msg.content as ContentBlock[]) {
        switch (block.type) {
          case "text":
            chars += block.text.length;
            break;
          case "tool_use":
            chars += JSON.stringify(block.input).length + block.name.length;
            break;
          case "tool_result":
            chars += block.content.length;
            break;
          case "thinking":
            chars += block.thinking.length;
            break;
        }
      }
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Compact conversation history by summarizing it via the LLM
 */
export async function compactConversation(
  messages: Message[],
  provider: LLMProvider,
  model: string,
  maxTokens: number
): Promise<{ messages: Message[]; summary: string; beforeTokens: number; afterTokens: number }> {
  if (messages.length <= 2) {
    return {
      messages,
      summary: "",
      beforeTokens: estimateTokens(messages),
      afterTokens: estimateTokens(messages),
    };
  }

  const beforeTokens = estimateTokens(messages);

  // Build conversation text for summarization
  const conversationText = messages.map(messageToText).join("\n\n");

  // Ask the LLM to summarize
  const summaryMessages: Message[] = [
    {
      role: "user",
      content: `Please summarize this conversation:\n\n${conversationText}`,
    },
  ];

  let summary = "";

  const stream = provider.stream({
    model,
    maxTokens: Math.min(maxTokens, 4096), // Limit summary length
    systemPrompt: COMPACT_SYSTEM_PROMPT,
    tools: [], // No tools needed for summarization
    messages: summaryMessages,
  });

  for await (const event of stream) {
    if (event.type === "text" && event.text) {
      summary += event.text;
    }
  }

  if (!summary) {
    // Summarization failed, return original
    return { messages, summary: "", beforeTokens, afterTokens: beforeTokens };
  }

  // Replace conversation with a single summary message
  const compactedMessages: Message[] = [
    {
      role: "user",
      content: `[Conversation Summary - previous messages were compacted to save context]\n\n${summary}\n\n[End of summary. Continue from here.]`,
    },
    {
      role: "assistant",
      content: "Understood. I have the full context from the summary above. How can I help you next?",
    },
  ];

  const afterTokens = estimateTokens(compactedMessages);

  return { messages: compactedMessages, summary, beforeTokens, afterTokens };
}
