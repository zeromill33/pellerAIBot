import { describe, expect, it } from "vitest";
import { buildTavilyLaneParams } from "../../../src/providers/tavily/lanes.js";

describe("buildTavilyLaneParams", () => {
  it("uses default lane parameters", () => {
    const params = buildTavilyLaneParams("A");
    expect(params.search_depth).toBe("basic");
    expect(params.max_results).toBe(5);
    expect(params.time_range).toBe("7d");
    expect(params.include_raw_content).toBe(true);
    expect(params.include_answer).toBe(false);
    expect(params.auto_parameters).toBe(true);
  });

  it("applies overrides from config", () => {
    const params = buildTavilyLaneParams("B", {
      default: { include_raw_content: false },
      lanes: {
        B_primary: {
          search_depth: "advanced",
          max_results: 8,
          time_range: "14d",
          include_domains: ["example.com"]
        }
      }
    });
    expect(params.search_depth).toBe("advanced");
    expect(params.max_results).toBe(8);
    expect(params.time_range).toBe("14d");
    expect(params.include_domains).toEqual(["example.com"]);
    expect(params.include_raw_content).toBe(false);
  });
});
