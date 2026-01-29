import type { PublishBatchInput, PublishBatchResult } from "./types.js";
import { runPublishBatch } from "./batch.js";
import { getLatestStatus, type StatusQuery, type StatusResult } from "./status.js";

export async function triggerPublishBatch(
  input: PublishBatchInput
): Promise<PublishBatchResult> {
  return runPublishBatch(input);
}

export async function triggerStatus(
  input: StatusQuery
): Promise<StatusResult> {
  return getLatestStatus(input);
}
