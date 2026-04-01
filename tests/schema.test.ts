/**
 * Tests for utils/schema.ts - Zod to JSON Schema conversion
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { zodToJsonSchema } from "../src/utils/schema.js";

describe("zodToJsonSchema", () => {
  it("should convert a simple object schema", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    const result = zodToJsonSchema(schema);
    assert.equal(result.type, "object");
    assert.equal(result.properties.name.type, "string");
    assert.equal(result.properties.age.type, "number");
    assert.deepEqual(result.required, ["name", "age"]);
  });

  it("should handle optional fields", () => {
    const schema = z.object({
      required_field: z.string(),
      optional_field: z.string().optional(),
    });

    const result = zodToJsonSchema(schema);
    assert.deepEqual(result.required, ["required_field"]);
  });

  it("should handle descriptions", () => {
    const schema = z.object({
      query: z.string().describe("The search query"),
    });

    const result = zodToJsonSchema(schema);
    assert.equal(result.properties.query.description, "The search query");
  });

  it("should handle boolean fields", () => {
    const schema = z.object({
      flag: z.boolean(),
    });

    const result = zodToJsonSchema(schema);
    assert.equal(result.properties.flag.type, "boolean");
  });

  it("should handle enum fields", () => {
    const schema = z.object({
      color: z.enum(["red", "green", "blue"]),
    });

    const result = zodToJsonSchema(schema);
    assert.equal(result.properties.color.type, "string");
    assert.deepEqual(result.properties.color.enum, ["red", "green", "blue"]);
  });

  it("should handle array fields", () => {
    const schema = z.object({
      tags: z.array(z.string()),
    });

    const result = zodToJsonSchema(schema);
    assert.equal(result.properties.tags.type, "array");
    assert.equal(result.properties.tags.items.type, "string");
  });

  it("should handle default values", () => {
    const schema = z.object({
      limit: z.number().default(10),
    });

    const result = zodToJsonSchema(schema);
    assert.equal(result.properties.limit.type, "number");
    assert.equal(result.properties.limit.default, 10);
  });
});
