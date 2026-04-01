/**
 * System prompt builder
 *
 * @source ../src/constants/prompts.ts - getSystemPrompt()
 * @source ../src/constants/system.ts - DEFAULT_PREFIX
 *
 * Original design:
 * - getSystemPrompt() returns string[] (array of sections)
 * - Sections are assembled dynamically based on features, tools, model
 * - Includes: prefix, tool instructions, env info, CLAUDE.md, git status,
 *   MCP instructions, skill instructions, output style, language settings
 * - Uses cache_control boundaries for prompt caching optimization
 *
 * Nano preserves:
 * - "Assembled, not written" pattern (prompt is built from parts)
 * - Environment info section
 * - Tool listing
 * - Project context injection
 *
 * Removed: dynamic sections, cache boundaries, MCP/skill instructions,
 * output style config, language settings, proactive mode
 */

/**
 * Build the system prompt from context parts.
 *
 * @source ../src/constants/prompts.ts - getSystemPrompt()
 * Original returns string[] that gets joined by the API layer.
 * Nano returns a single string for simplicity.
 */
export function buildSystemPrompt(
  projectContext: string,
  cwd: string
): string {
  // @source ../src/constants/system.ts - DEFAULT_PREFIX
  // Original: "You are Claude Code, Anthropic's official CLI for Claude."
  return `You are an expert AI coding assistant working in a terminal environment. You help users with coding tasks by reading, writing, and editing files, running commands, and searching codebases.

# Environment
- Working directory: ${cwd}
- Operating system: ${process.platform}
- Shell: bash

# Available Tools
You have the following tools available:
- **Bash**: Execute shell commands
- **FileRead**: Read file contents (with line numbers)
- **FileEdit**: Edit files using search-and-replace (old_string -> new_string)
- **FileWrite**: Create new files or completely rewrite existing ones
- **Grep**: Search file contents using regex patterns
- **Glob**: Find files by name/pattern

# Guidelines
1. Always read a file before editing it to ensure you have the exact content.
2. Use FileEdit for targeted changes (search-and-replace). Use FileWrite only for new files or complete rewrites.
3. When editing, include enough surrounding context in old_string to uniquely identify the location.
4. Prefer dedicated tools over Bash equivalents (e.g., use FileRead instead of \`cat\`, Grep instead of \`grep\`).
5. Be concise in your responses. Show what you did and why.
6. If a task requires multiple steps, execute them in sequence using tools.
7. When you encounter errors, diagnose and fix them.

${projectContext ? `# Project Context\n\n${projectContext}` : ""}
`.trim();
}
