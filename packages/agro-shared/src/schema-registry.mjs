import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.resolve(MODULE_DIR, "..", "schemas");

const SCHEMA_FILES = {
  "agent-state": "agent-state.schema.json",
  "compare-card": "compare-card.schema.json",
  "confirmation-gate": "confirmation-gate.schema.json",
  "error-gap": "error-gap.schema.json",
  "mission-state": "mission-state.schema.json",
  "route-mode": "route-mode.schema.json",
  "session-state": "session-state.schema.json",
  "transcript-event": "transcript-event.schema.json",
  verification: "verification-record.schema.json",
};

function loadSchemaFile(fileName) {
  const targetPath = path.join(SCHEMA_DIR, fileName);
  return JSON.parse(readFileSync(targetPath, "utf8"));
}

export const SCHEMAS = Object.freeze(
  Object.fromEntries(
    Object.entries(SCHEMA_FILES).map(([name, fileName]) => [name, loadSchemaFile(fileName)])
  )
);

function resolveSchemaReference(reference) {
  const fileName = reference.replace(/^\.\//, "");
  return loadSchemaFile(fileName);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesType(value, expectedType) {
  switch (expectedType) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isPlainObject(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
}

function validateValue(value, schema, valuePath = "$") {
  if (schema.$ref) {
    return validateValue(value, resolveSchemaReference(schema.$ref), valuePath);
  }

  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((typeName) => matchesType(value, typeName))) {
      throw new Error(`${valuePath} expected type ${expectedTypes.join("|")}.`);
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`${valuePath} must be one of ${schema.enum.join(", ")}.`);
  }

  if (schema.format === "date-time" && typeof value === "string" && Number.isNaN(Date.parse(value))) {
    throw new Error(`${valuePath} must be a valid date-time string.`);
  }

  if (typeof value === "number" && Number.isFinite(schema.minimum) && value < schema.minimum) {
    throw new Error(`${valuePath} must be >= ${schema.minimum}.`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateValue(item, schema.items, `${valuePath}[${index}]`));
  }

  if (isPlainObject(value)) {
    const properties = schema.properties || {};
    const required = schema.required || [];

    for (const requiredKey of required) {
      if (!(requiredKey in value)) {
        throw new Error(`${valuePath}.${requiredKey} is required.`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          throw new Error(`${valuePath}.${key} is not allowed by schema.`);
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value) {
        validateValue(value[key], propertySchema, `${valuePath}.${key}`);
      }
    }
  }
}

export function assertValidSchemaShape(schemaName, value) {
  const schema = SCHEMAS[schemaName];
  if (!schema) {
    throw new Error(`Unknown schema "${schemaName}".`);
  }

  validateValue(value, schema);
  return value;
}

export function cloneStructured(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
