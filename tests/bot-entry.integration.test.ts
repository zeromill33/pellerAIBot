import { describe, it, expect, vi } from "vitest";
import { handleBotCommand } from "../src/bot/index.js";
import type { PublishCommandResult } from "../src/bot/commands/publish.js";
import { handlePublishCommand } from "../src/bot/commands/publish.js";
import { handleStatusCommand } from "../src/bot/commands/status.js";
import { ERROR_CODES } from "../src/orchestrator/errors.js";
import type { BotConfig } from "../src/config/config.schema.js";

vi.mock("../src/bot/commands/publish.js", () => ({
  handlePublishCommand: vi.fn()
}));
vi.mock("../src/bot/commands/status.js", () => ({
  handleStatusCommand: vi.fn()
}));

describe("/publish bot entry", () => {
  const config: BotConfig = { admin_user_ids: [1001] };

  it("rejects non-admin users", async () => {
    const result = await handleBotCommand(
      { user_id: 2002, text: "/publish https://polymarket.com/event/alpha" },
      config
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") {
      throw new Error("Expected error result");
    }
    expect(result.error.code).toBe(ERROR_CODES.BOT_UNAUTHORIZED);
  });

  it("routes /publish to command handler", async () => {
    const mockResult: PublishCommandResult = {
      request_id: "req_test",
      event_slugs: ["alpha-market"],
      invalid_urls: [],
      successes: [],
      failures: [],
      summary: {
        total: 1,
        succeeded: 0,
        failed: 0,
        invalid: 0
      },
      receipt: {
        kind: "publish",
        request_id: "req_test",
        summary: {
          total: 1,
          succeeded: 0,
          failed: 0,
          invalid: 0
        },
        successes: [],
        failures: [],
        invalid_urls: []
      }
    };

    const mockHandler = vi.mocked(handlePublishCommand);
    mockHandler.mockResolvedValueOnce(mockResult);

    const result = await handleBotCommand(
      { user_id: 1001, text: "/publish https://polymarket.com/event/alpha" },
      config
    );

    expect(mockHandler).toHaveBeenCalledWith(
      "/publish https://polymarket.com/event/alpha"
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected ok result");
    }
    expect(result.receipt).toEqual(mockResult.receipt);
  });
});

describe("/status bot entry", () => {
  const config: BotConfig = { admin_user_ids: [1001] };

  it("routes /status to command handler", async () => {
    const mockResult = {
      receipt: {
        kind: "status" as const,
        slug: "alpha-market",
        status: "ready",
        generated_at: "2026-01-29T00:00:00Z",
        validator_code: null,
        validator_message: null
      }
    };

    const mockHandler = vi.mocked(handleStatusCommand);
    mockHandler.mockResolvedValueOnce(mockResult);

    const result = await handleBotCommand(
      { user_id: 1001, text: "/status alpha-market" },
      config
    );

    expect(mockHandler).toHaveBeenCalledWith("/status alpha-market");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected ok result");
    }
    expect(result.receipt).toEqual(mockResult.receipt);
  });
});
