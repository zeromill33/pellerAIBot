import { describe, it, expect, vi, beforeEach } from "vitest";

const commandRegistry = vi.hoisted(() =>
  new Map<string, (ctx: { reply: (text: string) => Promise<void> }) => Promise<void>>()
);
const createBotHandlerMock = vi.hoisted(() => vi.fn());

vi.mock("grammy", () => {
  class MockBot {
    token: string;
    command = vi.fn((name: string, handler: (ctx: any) => Promise<void>) => {
      commandRegistry.set(name, handler);
    });
    catch = vi.fn();
    start = vi.fn().mockResolvedValue(undefined);

    constructor(token: string) {
      this.token = token;
    }
  }

  return { Bot: MockBot };
});

vi.mock("../src/bot/index.js", () => ({
  createBotHandler: createBotHandlerMock
}));

describe("telegram bot smoke", () => {
  beforeEach(() => {
    commandRegistry.clear();
    createBotHandlerMock.mockReset();
  });

  it("starts bot and registers publish/status commands", async () => {
    const { startTelegramBot } = await import("../src/bot/telegram.js");
    const handler = vi.fn().mockResolvedValue({
      status: "ok",
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
    });
    createBotHandlerMock.mockReturnValue(handler);

    const bot = await startTelegramBot({
      admin_user_ids: [1001],
      bot_token: "token"
    });

    expect(bot.token).toBe("token");
    expect(bot.start).toHaveBeenCalledTimes(1);
    expect(commandRegistry.has("publish")).toBe(true);
    expect(commandRegistry.has("status")).toBe(true);
  });

  it("routes publish command to handler and replies", async () => {
    const { createTelegramBot } = await import("../src/bot/telegram.js");
    const handler = vi.fn().mockResolvedValue({
      status: "ok",
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
    });
    createBotHandlerMock.mockReturnValue(handler);

    createTelegramBot({ admin_user_ids: [1001], bot_token: "token" });

    const publishHandler = commandRegistry.get("publish");
    if (!publishHandler) {
      throw new Error("Expected publish handler to be registered");
    }

    const ctx = {
      from: { id: 1001 },
      message: { text: "/publish https://polymarket.com/event/alpha" },
      reply: vi.fn().mockResolvedValue(undefined)
    };

    await publishHandler(ctx);

    expect(handler).toHaveBeenCalledWith({
      user_id: 1001,
      text: "/publish https://polymarket.com/event/alpha"
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      "request_id: req_test\nsummary: total=1 succeeded=0 failed=0 invalid=0"
    );
  });

  it("rejects missing user id", async () => {
    const { createTelegramBot } = await import("../src/bot/telegram.js");
    const handler = vi.fn().mockResolvedValue({
      status: "ok",
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
    });
    createBotHandlerMock.mockReturnValue(handler);

    createTelegramBot({ admin_user_ids: [1001], bot_token: "token" });

    const publishHandler = commandRegistry.get("publish");
    if (!publishHandler) {
      throw new Error("Expected publish handler to be registered");
    }

    const ctx = {
      from: undefined,
      message: { text: "/publish" },
      reply: vi.fn().mockResolvedValue(undefined)
    };

    await publishHandler(ctx);

    expect(handler).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith("Unable to identify user");
  });
});
