import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import { triggerStatus } from "../../orchestrator/index.js";

export type StatusReceipt = {
  kind: "status";
  slug: string;
  status: string;
  generated_at: string;
  validator_code: string | null;
  validator_message: string | null;
};

export type StatusCommandResult = {
  receipt: StatusReceipt;
};

export function parseStatusSlug(commandText: string): string | null {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return null;
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  const first = tokens[0];
  if (!first) {
    return null;
  }
  if (first.startsWith("/status")) {
    return tokens[1] ?? null;
  }
  return tokens[0] ?? null;
}

export async function handleStatusCommand(
  commandText: string
): Promise<StatusCommandResult> {
  const slug = parseStatusSlug(commandText);
  if (!slug) {
    throw createAppError({
      code: ERROR_CODES.BOT_STATUS_MISSING_SLUG,
      message: "缺少 slug，请使用 /status <slug>",
      category: "VALIDATION",
      retryable: false,
      details: { command: commandText }
    });
  }

  const latest = await triggerStatus({ slug });
  return {
    receipt: {
      kind: "status",
      slug: latest.slug,
      status: latest.status,
      generated_at: latest.generated_at,
      validator_code: latest.validator_code,
      validator_message: latest.validator_message
    }
  };
}
