/**
 * Context collector - gathers project context for the system prompt
 */

import { readFile, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, basename } from "node:path";

/**
 * Collect project context to include in the system prompt
 */
export async function collectContext(cwd: string): Promise<string> {
  const parts: string[] = [];

  // 1. Read CLAUDE.md if it exists
  const claudeMd = await readFileSafe(join(cwd, "CLAUDE.md"));
  if (claudeMd) {
    parts.push("# Project Instructions (CLAUDE.md)\n\n" + claudeMd);
  }

  // 2. Detect project type from common files
  const projectInfo = await detectProjectType(cwd);
  if (projectInfo) {
    parts.push("# Project Info\n\n" + projectInfo);
  }

  // 3. Git info
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

async function detectProjectType(cwd: string): Promise<string | null> {
  const indicators: string[] = [];

  // Check for common project files
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

function getGitInfo(cwd: string): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const status = execSync("git status --short", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const parts = [`Branch: ${branch}`];
    if (status) {
      const changedFiles = status.split("\n").length;
      parts.push(`Changed files: ${changedFiles}`);
    } else {
      parts.push("Working tree clean");
    }

    return parts.join("\n");
  } catch {
    return null;
  }
}
