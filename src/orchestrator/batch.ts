import type { PublishBatchInput, PublishBatchResult } from "./types.js";
import { parseUrlsToSlugs } from "./steps/url.parse.step.js";

export async function runPublishBatch(
  input: PublishBatchInput
): Promise<PublishBatchResult> {
  const parseResult = parseUrlsToSlugs(input.urls);
  return {
    request_id: input.request_id,
    ...parseResult
  };
}
