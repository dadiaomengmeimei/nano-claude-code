/**
 * Utility to convert Zod schemas to JSON Schema for Anthropic API
 */

import { z } from "zod";

export function zodToJsonSchema(schema: z.ZodType<any>): Record<string, any> {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const zodValue = value as z.ZodType<any>;
      properties[key] = zodFieldToJsonSchema(zodValue);

      // Check if field is required (not optional)
      if (!(zodValue instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: "object" as const,
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  return { type: "object" as const, properties: {} };
}

function zodFieldToJsonSchema(field: z.ZodType<any>): Record<string, any> {
  // Unwrap optional
  if (field instanceof z.ZodOptional) {
    return zodFieldToJsonSchema(field._def.innerType);
  }

  // Unwrap default
  if (field instanceof z.ZodDefault) {
    const inner = zodFieldToJsonSchema(field._def.innerType);
    return { ...inner, default: field._def.defaultValue() };
  }

  if (field instanceof z.ZodString) {
    const result: Record<string, any> = { type: "string" };
    if (field.description) result.description = field.description;
    return result;
  }

  if (field instanceof z.ZodNumber) {
    const result: Record<string, any> = { type: "number" };
    if (field.description) result.description = field.description;
    return result;
  }

  if (field instanceof z.ZodBoolean) {
    const result: Record<string, any> = { type: "boolean" };
    if (field.description) result.description = field.description;
    return result;
  }

  if (field instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: field._def.values,
      ...(field.description ? { description: field.description } : {}),
    };
  }

  if (field instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodFieldToJsonSchema(field._def.type),
      ...(field.description ? { description: field.description } : {}),
    };
  }

  // Fallback: use description if available
  const result: Record<string, any> = { type: "string" };
  if (field.description) result.description = field.description;
  return result;
}
