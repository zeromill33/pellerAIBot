import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020";
import type { ErrorObject } from "ajv";

const schemaPath = new URL("./schema/report_v1.schema.json", import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, "utf-8")) as Record<
  string,
  unknown
>;

const ajv = new Ajv({ allErrors: true, strict: true });
const validateReportV1 = ajv.compile(schema);

export type SchemaValidationResult =
  | { ok: true }
  | { ok: false; errors: ErrorObject[] };

export function validateReportSchema(input: unknown): SchemaValidationResult {
  const valid = validateReportV1(input);
  if (valid) {
    return { ok: true };
  }

  const errors = validateReportV1.errors ? validateReportV1.errors.slice() : [];
  return { ok: false, errors };
}
