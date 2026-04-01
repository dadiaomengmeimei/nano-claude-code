#!/usr/bin/env npx tsx
/**
 * Tutorial 06: Search Tools + FileEdit (~350 lines)
 * ===================================================
 *
 * The final tutorial! We add the remaining tools to match nano-claude-code:
 * 1. Grep - search file contents by regex
 * 2. Glob - find files by name pattern
 * 3. FileEdit - search-and-replace editing (not just overwrite)
 *
 * This is essentially nano-claude-code in a single file.
 *
 * What you'll learn:
 * - Why FileEdit (search-replace) is better than FileWrite for edits
 * - How Grep + Glob give the agent "codebase awareness"
 * - The complete tool set that makes a useful coding agent
 *
 * Run: ANTHROPIC_API_KEY=sk-xxx npx tsx tutorials/06-search-and-edit.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { globSync } from "glob";
import * as readline from "node:readline";

const client = new Anthropic();
const CWD = process.cwd();

// === ALL 6 TOOLS ===
const tools: Anthropic.Messages.Tool[] = [
  { name: "Bash", description: "Run a shell command",
    input_schema: { type: "object" as const, properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "FileRead", description: "Read a file with line numbers",
    input_schema: { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "FileWrite", description: "Create a new file or completely rewrite an existing one",
    input_schema: { type: "object" as const, properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "FileEdit", description: "Edit a file by replacing exact text. old_string must match exactly.",
    input_schema: { type: "object" as const, properties: {
      path: { type: "string" },
      old_string: { type: "string", description: "Exact text to find" },
      new_string: { type: "string", description: "Replacement text" },
    }, required: ["path", "old_string", "new_string"] } },
  { name: "Grep", description: "Search file contents with regex. Returns matching lines with file:line format.",
    input_schema: { type: "object" as const, properties: {
      pattern: { type: "string", description: "Regex pattern" },
      path: { type: "string", description: "Directory to search (default: .)" },
      include: { type: "string", description: "File glob filter (e.g. *.ts)" },
    }, required: ["pattern"] } },
  { name: "Glob", description: "Find files matching a glob pattern (e.g. **/*.ts)",
    input_schema: { type: "object" as const, properties: {
      pattern: { type: "string", description: "Glob pattern" },
    }, required: ["pattern"] } },
];

const READ_ONLY = new Set(["FileRead", "Grep", "Glob"]);

// === TOOL EXECUTOR ===
function executeTool(name: string, input: Record<string, any>): string {
  try {
    switch (name) {
      case "Bash":
        return execSync(input.command, { encoding: "utf-8", timeout: 15000, cwd: CWD });

      case "FileRead": {
        const content = readFileSync(join(CWD, input.path), "utf-8");
        return content.split("\n").map((l, i) => `${String(i + 1).padStart(4)} | ${l}`).join("\n");
      }

      case "FileWrite":
        mkdirSync(dirname(join(CWD, input.path)), { recursive: true });
        writeFileSync(join(CWD, input.path), input.content, "utf-8");
        return `Wrote ${input.content.split("\n").length} lines to ${input.path}`;

      case "FileEdit": {
        const filePath = join(CWD, input.path);
        const content = readFileSync(filePath, "utf-8");
        if (!content.includes(input.old_string)) return `Error: old_string not found in ${input.path}`;
        const count = content.split(input.old_string).length - 1;
        if (count > 1) return `Error: old_string found ${count} times. Add more context to be unique.`;
        writeFileSync(filePath, content.replace(input.old_string, input.new_string), "utf-8");
        return `Edited ${input.path}: replaced ${input.old_string.split("\n").length} line(s)`;
      }

      case "Grep": {
        const searchPath = input.path ? join(CWD, input.path) : CWD;
        let cmd = `grep -rn --color=never -E '${input.pattern.replace(/'/g, "'\\''")}' '${searchPath}'`;
        if (input.include) cmd += ` --include='${input.include}'`;
        cmd += " | head -50";
        const result = execSync(cmd, { encoding: "utf-8", timeout: 10000 });
        return result || "No matches.";
      }

      case "Glob": {
        const files = globSync(input.pattern, {
          cwd: CWD, nodir: true,
          ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
        });
        return files.length ? files.sort().slice(0, 50).join("\n") : "No files found.";
      }

      default: return `Unknown tool: ${name}`;
    }
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

// === CONTEXT ===
function gatherContext(): string {
  const parts: string[] = [];
  try { parts.push(`## CLAUDE.md\n${readFileSync(join(CWD, "CLAUDE.md"), "utf-8")}`); } catch {}
  const checks: [string, string][] = [["package.json", "Node.js"], ["Cargo.toml", "Rust"], ["go.mod", "Go"], ["pyproject.toml", "Python"]];
  for (const [f, t] of checks) { try { statSync(join(CWD, f)); parts.push(`- ${t} project`); } catch {} }
  try { parts.push(`- Git: ${execSync("git rev-parse --abbrev-ref HEAD", { cwd: CWD, encoding: "utf-8" }).trim()}`); } catch {}
  return parts.join("\n");
}

function buildSystemPrompt(ctx: string): string {
  return `You are an expert AI coding assistant. CWD: ${CWD} | OS: ${process.platform}
Tools: Bash, FileRead, FileWrite, FileEdit, Grep, Glob
Rules:
1. ALWAYS read a file before editing it.
2. Use FileEdit for changes (search-replace). Use FileWrite only for new files.
3. Use Grep/Glob to explore code, not Bash equivalents.
4. Be concise.
${ctx ? `\n# Context\n${ctx}` : ""}`;
}

// === REPL (from Tutorial 05) ===
async function runTurn(
  messages: Anthropic.Messages.MessageParam[],
  systemPrompt: string,
  rl: readline.Interface,
) {
  for (let round = 0; round < 20; round++) {
    const stream = client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16384,
      system: systemPrompt,
      tools,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        const delta = event.delta as any;
        if (delta.type === "text_delta") process.stdout.write(delta.text);
      }
    }

    const final = await stream.finalMessage();
    messages.push({ role: "assistant", content: final.content });
    if (final.stop_reason !== "tool_use") return;

    const results: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type !== "tool_use") continue;
      const inp = block.input as Record<string, any>;
      const summary = inp.command || inp.path || inp.pattern || "";

      if (!READ_ONLY.has(block.name)) {
        console.log(`\n\x1b[33m⚠ ${block.name}: ${String(summary).slice(0, 80)}\x1b[0m`);
        const ok = await new Promise<boolean>((r) => {
          rl.question(`\x1b[33m  Allow? [y/N] \x1b[0m`, (a) => r(a.trim().toLowerCase() === "y"));
        });
        if (!ok) {
          results.push({ type: "tool_result", tool_use_id: block.id, content: "Denied.", is_error: true });
          continue;
        }
      }

      console.log(`\x1b[2m⚡ ${block.name}: ${String(summary).slice(0, 60)}\x1b[0m`);
      const output = executeTool(block.name, inp);
      console.log(`\x1b[2m${output.slice(0, 300)}\x1b[0m`);
      results.push({ type: "tool_result", tool_use_id: block.id, content: output });
    }
    messages.push({ role: "user", content: results });
  }
}

async function main() {
  const systemPrompt = buildSystemPrompt(gatherContext());
  let messages: Anthropic.Messages.MessageParam[] = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\x1b[1m\x1b[36mnano-claude-code\x1b[0m \x1b[2m— full tutorial (6 tools)\x1b[0m`);
  console.log(`\x1b[2mThis is the complete agent. Type a message or /exit to quit.\x1b[0m\n`);

  const prompt = () => rl.question("\x1b[1m\x1b[36m❯ \x1b[0m", async (input) => {
    input = input.trim();
    if (!input) return prompt();
    if (input === "/exit" || input === "/quit") { console.log("Bye!"); process.exit(0); }
    if (input === "/clear") { messages = []; console.log("\x1b[2mCleared.\x1b[0m\n"); return prompt(); }
    if (input === "/help") {
      console.log(`  /clear - Clear conversation\n  /exit  - Quit\n`);
      return prompt();
    }

    messages.push({ role: "user", content: input });
    console.log();
    try { await runTurn(messages, systemPrompt, rl); } catch (e: any) { console.error(`\x1b[31m${e.message}\x1b[0m`); }
    console.log("\n");
    prompt();
  });

  prompt();
}

main().catch(console.error);
