import { describe, expect, it } from "vitest";
import { buildPublishPipelineSteps } from "../../src/orchestrator/pipeline.js";
import type {
  EvidenceCandidate,
  MarketContext,
  PublishPipelineContext
} from "../../src/orchestrator/types.js";

describe("pipeline query.plan.build", () => {
  it("passes evidence_candidates into query plan evaluation", async () => {
    const steps = buildPublishPipelineSteps();
    const queryStep = steps.find((step) => step.id === "query.plan.build");
    if (!queryStep) {
      throw new Error("Missing query.plan.build step");
    }

    const marketContext: MarketContext = {
      event_id: "event-evidence-pipeline",
      slug: "event-evidence-pipeline",
      title: "Will Team C win the finals",
      description: "Finals matchup evidence",
      resolution_rules_raw: "Resolves to Yes if Team C wins.",
      end_time: "2026-06-01T00:00:00Z",
      markets: []
    };
    const evidenceCandidates: EvidenceCandidate[] = [{ stance: "supports_no" }];

    const result = await queryStep.run({
      request_id: "req-1",
      run_id: "run-1",
      event_slug: marketContext.slug,
      market_context: marketContext,
      evidence_candidates: evidenceCandidates
    } as PublishPipelineContext);

    const hasDLane = result.query_plan?.lanes.some((lane) => lane.lane === "D");
    expect(hasDLane).toBe(true);
  });
});
