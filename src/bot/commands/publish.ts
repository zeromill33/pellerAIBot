import { guardPublishUrls } from "../guard.js";
import { triggerPublishBatch } from "../../orchestrator/index.js";
import { buildRequestId } from "../../utils/id.js";
import type { PublishBatchResult } from "../../orchestrator/types.js";

export function parsePublishUrls(commandText: string): string[] {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return [];
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }

  const first = tokens[0];
  if (!first) {
    return [];
  }

  if (first.startsWith("/publish")) {
    return tokens.slice(1);
  }

  return tokens;
}

export async function handlePublishCommand(
  commandText: string,
  options?: { request_id?: string }
): Promise<PublishBatchResult> {
  const urls = parsePublishUrls(commandText);
  guardPublishUrls(urls);

  return triggerPublishBatch({
    request_id: options?.request_id ?? buildRequestId(),
    urls
  });
}
