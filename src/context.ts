/**
 * Context collector - gathers project context for the system prompt
 *
 * @source ../src/context.ts - getUserContext(), getSystemContext(), getGitStatus()
 *
 * Original design:
 * - getUserContext(): memoized, reads CLAUDE.md files (multi-level: cwd, parent
 *   dirs, home dir), filters injected memory files, caches for auto-mode classifier
 * - getSystemContext(): memoized, collects git status (branch, status, log, user),
 *   truncates at 2000 chars, includes cache-breaking injection
 * - Both use lodash memoize() so they're computed once per session
 *
 * Nano preserves:
 * - CLAUDE.md reading (single level only - cwd)
 * - Git info collection (branch, status, recent commits)
 * - Project type detection from common files
 *
 * Removed: memoize, multi-level CLAUDE.md, memory file filtering,
 * cache-breaking injection, diagnostic logging
 */

import { readFile, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";

/**
 * Max characters for git status before truncation.
 * @source ../src/context.ts - const MAX_STATUS_CHARS = 2000
 */
const MAX_STATUS_CHARS = 2000;

/**
 * Collect project context to include in the system prompt.
 *
 * @source ../src/context.ts - getUserContext() + getSystemContext()
 * In the original, these are two separate memoized functions that return
 * key-value maps. The system prompt builder (prompts.ts) assembles them
 * into the final prompt. Nano combines them into a single string.
 */
export async function collectContext(cwd: string): Promise<string> {
  const parts: string[] = [];

  // -- 1. CLAUDE.md --
  // @source context.ts: getUserContext() -> getClaudeMds(getMemoryFiles())
  // Original walks up directory tree and reads CLAUDE.md at each level.
  // Nano reads only from cwd.
  const claudeMd = await readFileSafe(join(cwd, "CLAUDE.md"));
  if (claudeMd) {
    parts.push("# Project Instructions (CLAUDE.md)\n\n" + claudeMd);
  }

  // -- 2. Project type detection --
  // @source Not directly in context.ts, but prompts.ts computeEnvInfo()
  // detects project type from environment.
  const projectInfo = await detectProjectType(cwd);
  if (projectInfo) {
    parts.push("# Project Info\n\n" + projectInfo);
  }

  // -- 3. Git info --
  // @source context.ts: getGitStatus() - memoized, collects branch,
  // main branch, status (truncated at 2000 chars), recent commits, user name
  const gitInfo = getGitInfo(cwd);
  if (gitInfo) {
    parts.push("# Git Info\n\n" + gitInfo);
  }

  return parts.join("\n\n---\n\n");
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Detect project type from common files.
 *
 * @source ../src/constants/prompts.ts - computeEnvInfo()
 * Original detects: isGit, platform, shell, OS version, model info.
 * Nano detects project type from package.json, Cargo.toml, etc.
 */
async function detectProjectType(cwd: string): Promise<string | null> {
  const indicators: string[] = [];

  const checks: [string, string][] = [
    ["package.json", "Node.js/JavaScript project"],
    ["Cargo.toml", "Rust project"],
    ["go.mod", "Go project"],
    ["pyproject.toml", "Python project"],
    ["requirements.txt", "Python project"],
    ["pom.xml", "Java/Maven project"],
    ["build.gradle", "Java/Gradle project"],
    ["Gemfile", "Ruby project"],
    ["composer.json", "PHP project"],
    ["Makefile", "Has Makefile"],
  ];

  for (const [file, desc] of checks) {
    try {
      await stat(join(cwd, file));
      indicators.push(`- ${desc} (${file})`);
    } catch {
      // File doesn't exist
    }
  }

  if (indicators.length === 0) return null;
  return `Detected:\n${indicators.join("\n")}`;
}

/**
 * Collect git information.
 *
 * @source ../src/context.ts - getGitStatus()
 * Original collects: branch, main branch, status (truncated), recent commits,
 * user name. All via parallel Promise.all() calls.
 * Nano does the same but synchronously (simpler for a CLI tool).
 */
function getGitInfo(cwd: string): string | null {
  try {
    // @source context.ts: getBranch()
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // @source context.ts: git status --short, truncated at MAX_STATUS_CHARS
    const status = execSync("git status --short", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // @source context.ts: git log --oneline -n 5
    const log = execSync("git log --oneline -n 5", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Build output matching original format
    const parts = [
      `This is the git status at the start of the conversation.`,
      `Current branch: ${branch}`,
    ];

    if (status) {
      // @source context.ts: truncation at MAX_STATUS_CHARS
      const truncatedStatus =
        status.length > MAX_STATUS_CHARS
          ? status.substring(0, MAX_STATUS_CHARS) +
            "\n... (truncated, run `git status` for full output)"
          : status;
      const changedFiles = status.split("\n").length;
      parts.push(`Changed files: ${changedFiles}`);
      parts.push(`Status:\n${truncatedStatus}`);
    } else {
      parts.push("Working tree clean");
    }

    if (log) {
      parts.push(`Recent commits:\n${log}`);
    }

    return parts.join("\n");
  } catch {
    return null;
  }
}
