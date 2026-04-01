# nano-claude-code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**A minimal AI coding agent in 1,646 lines of TypeScript.**

> Inspired by [Claude Code](https://docs.anthropic.com/en/docs/claude-code)'s 512K+ line codebase. Same core loop. 99.7% less code.

```
User Input → LLM → Tool Calls → Execute → Feed Results Back → Repeat
```

![nano-claude-code in action](imgs/image.png)

## Quick Start

```bash
git clone https://github.com/dadiaomengmeimei/nano-claude-code.git
cd nano-claude-code
npm install && npm run build
export ANTHROPIC_API_KEY=sk-ant-your-key-here
npm start
```

## vs Claude Code

| | Claude Code | nano-claude-code |
|---|---|---|
| Source files | ~1,900 | **15** |
| Lines of code | 512,000+ | **1,646** |
| Runtime deps | 50+ | **4** |
| Tools | 40+ | **6** |
| Runtime | Bun | **Node.js ≥ 20** |

## Features

- 🔄 **Agent Loop** — Query → tool-use → result → reasoning cycle (up to 30 rounds)
- 🌊 **Streaming** — Real-time token-by-token output
- 🛠️ **6 Tools** — Bash, FileRead, FileEdit, FileWrite, Grep, Glob
- 🔐 **Permissions** — Read-only auto-allowed; write/shell requires confirmation
- 📋 **Context Aware** — Auto-reads `CLAUDE.md`, detects project type, gathers Git info
- 💬 **REPL** — Slash commands (`/help`, `/clear`, `/history`, `/exit`)
- 📡 **Pipe Mode** — `echo "fix the bug" | nano-claude` for scripting
- 🔌 **Extensible** — `LLMProvider` interface for OpenAI/Ollama/local models

## Architecture

```
src/
├── main.ts            # Terminal REPL + permission UI
├── agentLoop.ts       # Core: LLM → tool detection → execution → loop
├── types.ts           # Message, Tool, Provider, Config types
├── prompt.ts          # System prompt builder
├── context.ts         # CLAUDE.md + project detection + Git
├── api/anthropic.ts   # Anthropic streaming provider
├── tools/             # 6 tools: bash, fileRead, fileEdit, fileWrite, grep, glob
└── utils/             # Config loading, Zod → JSON Schema
```

## Configuration

Via environment variables or `~/.nano-claude.json`:

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Your API key |
| `NANO_MODEL` | `claude-sonnet-4-20250514` | Model |
| `NANO_MAX_TOKENS` | `16384` | Max tokens per response |
| `NANO_PERMISSION_MODE` | `ask` | `ask` or `auto` |

## Extending

**Add a tool** — implement `ToolDefinition`, register in `src/tools/index.ts`:

```typescript
export const MyTool: ToolDefinition = {
  name: "MyTool",
  description: "Does something useful",
  inputSchema: z.object({ query: z.string() }),
  async call(rawInput, context) {
    const input = this.inputSchema.parse(rawInput);
    return { output: `Result: ${input.query}` };
  },
  formatResult: (r) => r.output,
};
```

**Add a provider** — implement `LLMProvider` interface. See `src/api/anthropic.ts`.

## Sister Project

📖 **[Claude Code Sourcemap Learning Notebook](https://github.com/dadiaomengmeimei/claude-code-sourcemap-learning-notebook)** — Deep architectural analysis of the full Claude Code codebase. 8 chapters, 11 transferable design patterns, ~5.5 hours of content.

**Read the notebook to understand *why*. Run nano-claude-code to understand *how*.**

## License

MIT
