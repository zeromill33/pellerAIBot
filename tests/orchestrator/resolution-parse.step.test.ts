import { describe, expect, it } from "vitest";
import { parseResolutionRules } from "../../src/orchestrator/steps/resolution.parse.step.js";

describe("resolution.parse step", () => {
  it("parses resolver url, deadline, exclusions, and partial shutdown flag", async () => {
    const rules =
      "This market will resolve by 2026-12-31T23:59:00Z. " +
      "Partial shutdowns will count. " +
      "Acting appointments will not count.";
    const { resolution_structured } = await parseResolutionRules({
      event_slug: "event-1",
      resolution_rules_raw: rules,
      resolution_source_raw: "Primary source: https://official.example.com/resolution"
    });

    expect(resolution_structured.resolver_url).toBe(
      "https://official.example.com/resolution"
    );
    expect(resolution_structured.deadline_ts).toBe(
      Date.parse("2026-12-31T23:59:00Z")
    );
    expect(resolution_structured.partial_shutdown_counts).toBe(true);
    expect(resolution_structured.exclusions).toEqual([
      "Acting appointments will not count."
    ]);
    expect(resolution_structured.parse_error).toBeUndefined();
  });

  it("returns parse_error when rules missing", async () => {
    const { resolution_structured } = await parseResolutionRules({
      event_slug: "event-2",
      resolution_rules_raw: ""
    });

    expect(resolution_structured.deadline_ts).toBeNull();
    expect(resolution_structured.resolver_url).toBeNull();
    expect(resolution_structured.partial_shutdown_counts).toBeNull();
    expect(resolution_structured.exclusions).toEqual([]);
    expect(resolution_structured.parse_error).toContain("deadline_ts_missing");
  });
});
