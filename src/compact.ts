/**
 * Compact - Conversation summarization to reduce token usage
 *
 * @source ../src/services/compact/compact.ts - compactConversation()
 * @source ../src/services/compact/autoCompact.ts - shouldAutoCompact(), autoCompactIfNeeded()
 * @source ../src/services/compact/prompt.ts - getCompactPrompt(), formatCompactSummary()
 *
 * Original design (5-layer compression pipeline):
 * 1. toolResultBudget - Truncate large tool results inline
 * 2. snip - Remove old tool results entirely
 * 3. microCompact - LLM-summarize individual large tool results
 * 4. contextCollapse - Commit old turns to a side-chain
 * 5. autoCompact - Full conversation summarization via LLM
 *
 * Plus reactive compact (413 recovery) when API returns prompt_too_long.
 *
 * Nano implements only layer 5 (autoCompact) - the most impactful one.
 * The compact prompt is extracted directly from the original prompt.ts.
 *
 * Removed: layers 1-4, reactive compact, session memory compact,
 * post-compact cleanup, partial compact, recompaction tracking
 */

import type { Message, ContentBlock, LLMProvider } from "./types.js";

/**
 * Compact system prompt.
 *
 * @source ../src/services/compact/prompt.ts - getCompactPrompt()
 * Original has BASE_COMPACT_PROMPT (full) and PARTIAL_COMPACT_PROMPT (partial).
 * Both include NO_TOOLS_PREAMBLE and NO_TOOLS_TRAILER to prevent tool calls.
 * Nano uses a simplified version of the full compact prompt.
 */
const COMPACT_SYSTEM_PROMPT = `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.

Before providing your final summary, wrap your analysis in <analysis> tags. In your analysis:
1. Chronologically analyze each message. For each section identify:
   - The user's explicit requests and intents
   - Key decisions, technical concepts and code patterns
   - Specific details: file names, code snippets, function signatures, file edits
   - Errors encountered and how they were fixed
   - User feedback, especially corrections

Your summary should include:
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections (with snippets)
4. Errors and fixes
5. Problem Solving
6. Pending Tasks
7. Current Work (what was being worked on immediately before this summary)
8. Optional Next Step

REMINDER: Do NOT call any tools. Respond with plain text only.`;

/**
 * Extract text content from a message for summarization.
 *
 * @source ../src/services/compact/compact.ts - buildConversationText()
 * Original builds a structured representation for the LLM.
 * Nano extracts a simpler text representation.
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
 * Estimate token count (rough: ~4 chars per token).
 *
 * @source ../src/utils/tokens.ts - tokenCountWithEstimation()
 * Original uses a more sophisticated estimation that accounts for
 * different content types and has API-based counting for accuracy.
 * Nano uses the simple 4-chars-per-token heuristic.
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
 * Format compact summary by stripping analysis scratchpad.
 *
 * @source ../src/services/compact/prompt.ts - formatCompactSummary()
 * Original strips <analysis> tags and reformats <summary> tags.
 */
function formatCompactSummary(summary: string): string {
  let formatted = summary;

  // Strip analysis section (drafting scratchpad)
  formatted = formatted.replace(/<analysis>[\s\S]*?<\/analysis>/, "");

  // Extract and format summary section
  const summaryMatch = formatted.match(/<summary>([\s\S]*?)<\/summary>/);
  if (summaryMatch) {
    const content = summaryMatch[1] || "";
    formatted = formatted.replace(
      /<summary>[\s\S]*?<\/summary>/,
      `Summary:\n${content.trim()}`
    );
  }

  // Clean up extra whitespace
  formatted = formatted.replace(/\n\n+/g, "\n\n");

  return formatted.trim();
}

/**
 * Compact conversation history by summarizing it via the LLM.
 *
 * @source ../src/services/compact/compact.ts - compactConversation()
 * Original has: cache-safe params, partial compact, recompaction info,
 * post-compact cleanup, session memory compact, transcript path injection.
 * Nano does a simple full-conversation summarization.
 *
 * @source ../src/services/compact/prompt.ts - getCompactUserSummaryMessage()
 * Original wraps the summary with continuation instructions.
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
    return { messages, summary: "", beforeTokens, afterTokens: beforeTokens };
  }

  // Format the summary (strip <analysis>, format <summary>)
  const formattedSummary = formatCompactSummary(summary);

  // Replace conversation with summary + continuation message
  // @source prompt.ts: getCompactUserSummaryMessage()
  const compactedMessages: Message[] = [
    {
      role: "user",
      content: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n${formattedSummary}\n\n[End of summary. Continue from here.]`,
    },
    {
      role: "assistant",
      content: "Understood. I have the full context from the summary above. How can I help you next?",
    },
  ];

  const afterTokens = estimateTokens(compactedMessages);

  return { messages: compactedMessages, summary: formattedSummary, beforeTokens, afterTokens };
}
