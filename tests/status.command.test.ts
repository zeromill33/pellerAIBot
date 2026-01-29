import { describe, it, expect, vi } from "vitest";
import { handleStatusCommand, parseStatusSlug } from "../src/bot/commands/status.js";
import { ERROR_CODES } from "../src/orchestrator/errors.js";

vi.mock("../src/orchestrator/index.js", () => ({
  triggerStatus: vi.fn()
}));

const { triggerStatus } = await import("../src/orchestrator/index.js");

describe("parseStatusSlug", () => {
  it("parses slug from /status command", () => {
    expect(parseStatusSlug("/status alpha-market")).toBe("alpha-market");
  });

  it("returns null when missing slug", () => {
    expect(parseStatusSlug("/status")).toBeNull();
  });
});

describe("handleStatusCommand", () => {
  it("returns status receipt", async () => {
    vi.mocked(triggerStatus).mockResolvedValueOnce({
      report_id: "report_run_1",
      slug: "alpha-market",
      generated_at: "2026-01-29T00:00:00Z",
      status: "ready",
      validator_code: null,
      validator_message: null
    });

    const result = await handleStatusCommand("/status alpha-market");
    expect(result.receipt).toEqual({
      kind: "status",
      slug: "alpha-market",
      status: "ready",
      generated_at: "2026-01-29T00:00:00Z",
      validator_code: null,
      validator_message: null
    });
  });

  it("throws when slug missing", async () => {
    await expect(handleStatusCommand("/status")).rejects.toMatchObject({
      code: ERROR_CODES.BOT_STATUS_MISSING_SLUG
    });
  });
});
