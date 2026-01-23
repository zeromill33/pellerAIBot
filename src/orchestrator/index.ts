import type { PublishBatchInput, PublishBatchResult } from "./types.js";
import { runPublishBatch } from "./batch.js";

export async function triggerPublishBatch(
  input: PublishBatchInput
): Promise<PublishBatchResult> {
  return runPublishBatch(input);
}
