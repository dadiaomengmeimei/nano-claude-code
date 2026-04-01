/**
 * Tests for tool implementations
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BashTool } from "../src/tools/bash.js";
import { FileReadTool } from "../src/tools/fileRead.js";
import { FileWriteTool } from "../src/tools/fileWrite.js";
import { FileEditTool } from "../src/tools/fileEdit.js";
import { GrepTool } from "../src/tools/grep.js";
import { GlobTool } from "../src/tools/glob.js";
import type { ToolContext } from "../src/types.js";

const TEST_DIR = join(process.cwd(), ".test-sandbox");
const ctx: ToolContext = { cwd: TEST_DIR };

before(() => {
  // Create test sandbox
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "src"), { recursive: true });

  // Create test files
  writeFileSync(join(TEST_DIR, "hello.txt"), "Hello World\nLine 2\nLine 3\n");
  writeFileSync(join(TEST_DIR, "src/app.ts"), "const x = 1;\nconst y = 2;\nexport { x, y };\n");
  writeFileSync(join(TEST_DIR, "src/utils.ts"), "export function add(a: number, b: number) {\n  return a + b;\n}\n");
});

after(() => {
  // Cleanup test sandbox
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ============================================================
// BashTool
// ============================================================

describe("BashTool", () => {
  it("should execute a simple command", async () => {
    const result = await BashTool.call({ command: "echo hello" }, ctx);
    assert.ok(!result.isError);
    assert.ok(result.output.includes("hello"));
  });

  it("should return error for failing commands", async () => {
    const result = await BashTool.call({ command: "exit 1" }, ctx);
    assert.equal(result.isError, true);
  });

  it("should respect timeout", async () => {
    const result = await BashTool.call({ command: "sleep 10", timeout: 500 }, ctx);
    assert.equal(result.isError, true);
  });

  it("should capture stderr", async () => {
    const result = await BashTool.call({ command: "echo err >&2" }, ctx);
    assert.ok(result.output.includes("err"));
  });

  it("should use the correct working directory", async () => {
    const result = await BashTool.call({ command: "pwd" }, ctx);
    assert.ok(result.output.includes(TEST_DIR));
  });
});

// ============================================================
// FileReadTool
// ============================================================

describe("FileReadTool", () => {
  it("should read a file with line numbers", async () => {
    const result = await FileReadTool.call({ file_path: "hello.txt" }, ctx);
    assert.equal(result.isError, undefined);
    assert.ok(result.output.includes("Hello World"));
    assert.ok(result.output.includes("1 |"));
  });

  it("should support offset and limit", async () => {
    const result = await FileReadTool.call({ file_path: "hello.txt", offset: 2, limit: 1 }, ctx);
    assert.ok(result.output.includes("Line 2"));
    assert.ok(!result.output.includes("Hello World"));
  });

  it("should return error for non-existent file", async () => {
    const result = await FileReadTool.call({ file_path: "nonexistent.txt" }, ctx);
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("not found"));
  });
});

// ============================================================
// FileWriteTool
// ============================================================

describe("FileWriteTool", () => {
  it("should create a new file", async () => {
    const result = await FileWriteTool.call(
      { file_path: "new-file.txt", content: "new content" },
      ctx
    );
    assert.equal(result.isError, undefined);
    assert.ok(result.output.includes("Created"));

    const content = await readFile(join(TEST_DIR, "new-file.txt"), "utf-8");
    assert.equal(content, "new content");
  });

  it("should overwrite an existing file", async () => {
    writeFileSync(join(TEST_DIR, "overwrite.txt"), "old");
    const result = await FileWriteTool.call(
      { file_path: "overwrite.txt", content: "new" },
      ctx
    );
    assert.ok(result.output.includes("Wrote"));

    const content = await readFile(join(TEST_DIR, "overwrite.txt"), "utf-8");
    assert.equal(content, "new");
  });

  it("should create parent directories", async () => {
    const result = await FileWriteTool.call(
      { file_path: "deep/nested/dir/file.txt", content: "deep" },
      ctx
    );
    assert.equal(result.isError, undefined);
    assert.ok(existsSync(join(TEST_DIR, "deep/nested/dir/file.txt")));
  });
});

// ============================================================
// FileEditTool
// ============================================================

describe("FileEditTool", () => {
  it("should replace text in a file", async () => {
    writeFileSync(join(TEST_DIR, "edit-test.txt"), "foo bar baz");
    const result = await FileEditTool.call(
      { file_path: "edit-test.txt", old_string: "bar", new_string: "qux" },
      ctx
    );
    assert.equal(result.isError, undefined);

    const content = await readFile(join(TEST_DIR, "edit-test.txt"), "utf-8");
    assert.equal(content, "foo qux baz");
  });

  it("should return error when old_string not found", async () => {
    writeFileSync(join(TEST_DIR, "edit-test2.txt"), "hello");
    const result = await FileEditTool.call(
      { file_path: "edit-test2.txt", old_string: "xyz", new_string: "abc" },
      ctx
    );
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("not found"));
  });

  it("should handle replace_all", async () => {
    writeFileSync(join(TEST_DIR, "edit-all.txt"), "aaa bbb aaa");
    const result = await FileEditTool.call(
      { file_path: "edit-all.txt", old_string: "aaa", new_string: "ccc", replace_all: true },
      ctx
    );
    assert.equal(result.isError, undefined);

    const content = await readFile(join(TEST_DIR, "edit-all.txt"), "utf-8");
    assert.equal(content, "ccc bbb ccc");
  });

  it("should error on ambiguous match without replace_all", async () => {
    writeFileSync(join(TEST_DIR, "edit-ambig.txt"), "aaa bbb aaa");
    const result = await FileEditTool.call(
      { file_path: "edit-ambig.txt", old_string: "aaa", new_string: "ccc" },
      ctx
    );
    assert.equal(result.isError, true);
    assert.ok(result.output.includes("2 times"));
  });

  it("should delete text when new_string is empty", async () => {
    writeFileSync(join(TEST_DIR, "edit-del.txt"), "keep remove keep");
    const result = await FileEditTool.call(
      { file_path: "edit-del.txt", old_string: " remove", new_string: "" },
      ctx
    );
    assert.equal(result.isError, undefined);

    const content = await readFile(join(TEST_DIR, "edit-del.txt"), "utf-8");
    assert.equal(content, "keep keep");
  });
});

// ============================================================
// GrepTool
// ============================================================

describe("GrepTool", () => {
  it("should find matches", async () => {
    const result = await GrepTool.call({ pattern: "Hello" }, ctx);
    assert.equal(result.isError, undefined);
    assert.ok(result.output.includes("Hello World"));
  });

  it("should support include filter", async () => {
    const result = await GrepTool.call({ pattern: "const", include: "*.ts" }, ctx);
    assert.ok(result.output.includes("const"));
  });

  it("should return no matches message", async () => {
    const result = await GrepTool.call({ pattern: "zzzznonexistent" }, ctx);
    assert.ok(result.output.includes("No matches"));
  });
});

// ============================================================
// GlobTool
// ============================================================

describe("GlobTool", () => {
  it("should find files by pattern", async () => {
    const result = await GlobTool.call({ pattern: "**/*.ts" }, ctx);
    assert.equal(result.isError, undefined);
    assert.ok(result.output.includes("app.ts"));
    assert.ok(result.output.includes("utils.ts"));
  });

  it("should find files in subdirectory", async () => {
    const result = await GlobTool.call({ pattern: "*.ts", path: "src" }, ctx);
    assert.ok(result.output.includes("app.ts"));
  });

  it("should return no files message for non-matching pattern", async () => {
    const result = await GlobTool.call({ pattern: "**/*.xyz" }, ctx);
    assert.ok(result.output.includes("No files found"));
  });
});
