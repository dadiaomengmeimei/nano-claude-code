# nano-claude-code

A minimal, hackable AI coding assistant for the terminal — inspired by [Claude Code](https://docs.anthropic.com/en/docs/claude-code), distilled to its essence.

> **1,646 lines of TypeScript. 15 source files. 4 runtime dependencies.**
> Everything you need to pair-program with an LLM in your terminal. Nothing you don't.

## Why?

Claude Code is a powerful 512K+ line codebase with 1,900+ files. That's great for a production product, but hard to understand, modify, or learn from. **nano-claude-code** strips it down to the core loop that makes AI coding assistants work:

```
User Input → LLM → Tool Calls → Execute → Feed Results Back → Repeat
```

## Features

- 🔄 **Agent Loop** — The core query → tool-use → result → reasoning cycle (up to 30 rounds)
- 🌊 **Streaming Output** — Real-time token-by-token display as the LLM thinks
- 🛠️ **6 Essential Tools** — Bash, FileRead, FileEdit, FileWrite, Grep, Glob
- 🔐 **Permission System** — Read-only tools auto-allowed; write/shell operations require confirmation
- 📋 **Context Awareness** — Auto-reads `CLAUDE.md`, detects project type, gathers Git info
- 💬 **Interactive REPL** — Slash commands (`/help`, `/clear`, `/history`, `/exit`)
- 📡 **Pipe Mode** — Non-interactive mode for scripting: `echo "fix the bug" | nano-claude`
- 🔌 **Provider Abstraction** — `LLMProvider` interface ready for OpenAI/Ollama/local models

## Architecture

```
nano-claude-code/
├── src/
│   ├── main.ts               # Entry: terminal REPL + slash commands + permission UI
│   ├── agentLoop.ts           # Core: LLM call → tool detection → execution → loop
│   ├── types.ts               # Type definitions: Message, Tool, Provider, Config
│   ├── prompt.ts              # System prompt builder
│   ├── context.ts             # Context collector (CLAUDE.md + project detection + Git)
│   ├── api/
│   │   └── anthropic.ts       # Anthropic streaming API provider
│   ├── tools/
│   │   ├── index.ts           # Tool registry
│   │   ├── bash.ts            # Shell command execution
│   │   ├── fileRead.ts        # File reading with line numbers
│   │   ├── fileEdit.ts        # Search-and-replace editing
│   │   ├── fileWrite.ts       # File creation/writing
│   │   ├── grep.ts            # Regex search (ripgrep/grep)
│   │   └── glob.ts            # File pattern matching
│   └── utils/
│       ├── config.ts          # Config loading (env vars + JSON file)
│       └── schema.ts          # Zod → JSON Schema conversion
├── package.json
└── tsconfig.json
```

### Comparison with Claude Code

| Metric | Claude Code | nano-claude-code |
|---|---|---|
| Source files | ~1,900 | **15** |
| Lines of code | 512,000+ | **1,646** |
| Runtime dependencies | 50+ | **4** |
| Tools | 40+ | **6** |
| Runtime | Bun | **Node.js ≥ 20** |

## Quick Start

### Prerequisites

- Node.js ≥ 20
- An Anthropic API key

### Install & Run

```bash
# Clone
git clone https://github.com/dadiaomengmeimei/nano-claude-code.git
cd nano-claude-code

# Install dependencies
npm install

# Build
npm run build

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# Run
npm start
```

### Configuration

Configuration is loaded from environment variables and `~/.nano-claude.json`:

| Env Variable | Config Key | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | `apiKey` | — | Your Anthropic API key |
| `NANO_MODEL` | `model` | `claude-sonnet-4-20250514` | Model to use |
| `NANO_MAX_TOKENS` | `maxTokens` | `16384` | Max tokens per response |
| `NANO_PERMISSION_MODE` | `permissionMode` | `ask` | `ask` or `auto` |

Example `~/.nano-claude.json`:

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "maxTokens": 16384,
  "permissionMode": "ask"
}
```

### Usage

**Interactive mode:**

```bash
npm start
# Then type your requests:
❯ Read the package.json and tell me about this project
❯ Find all TODO comments in the codebase
❯ Fix the type error in src/utils.ts
❯ /help
❯ /clear
❯ /exit
```

**Pipe mode (for scripting):**

```bash
echo "List all TypeScript files in src/" | ANTHROPIC_API_KEY=sk-ant-xxx npm start
```

## How It Works

The core is the **Agent Loop** (`agentLoop.ts`):

```
┌─────────────────────────────────────────────┐
│                 Agent Loop                   │
│                                              │
│  1. Send messages to LLM (streaming)         │
│  2. Receive response tokens in real-time     │
│  3. If response contains tool_use blocks:    │
│     a. Parse tool name + input               │
│     b. Check permissions (ask/auto)          │
│     c. Execute tool                          │
│     d. Append tool result to conversation    │
│     e. Go to step 1                          │
│  4. If response is pure text: done           │
│                                              │
│  Max rounds: 30                              │
└─────────────────────────────────────────────┘
```

## Extending

### Add a new tool

```typescript
// src/tools/myTool.ts
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "../types.js";

const inputSchema = z.object({
  query: z.string().describe("What to search for"),
});

export const MyTool: ToolDefinition = {
  name: "MyTool",
  description: "Does something useful",
  inputSchema,
  async call(rawInput, context) {
    const input = inputSchema.parse(rawInput);
    // Your logic here
    return { output: `Result for: ${input.query}` };
  },
  formatResult(result) {
    return result.output;
  },
};
```

Then register it in `src/tools/index.ts`.

### Add a new LLM provider

Implement the `LLMProvider` interface:

```typescript
export interface LLMProvider {
  name: string;
  stream(options: ProviderOptions): AsyncIterable<StreamEvent>;
}
```

See `src/api/anthropic.ts` for a reference implementation.

## License

MIT
