import type { PublishPipelineInput, PublishPipelineResult } from "./types.js";

export async function runPublishPipeline(
  input: PublishPipelineInput
): Promise<PublishPipelineResult> {
  return {
    event_slug: input.event_slug,
    run_id: input.run_id,
    status: "success"
  };
}
