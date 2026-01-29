import { describe, expect, it, vi } from "vitest";
import { createTelegramPublisher } from "../../../src/providers/telegram/index.js";

function buildResponse(params: {
  ok: boolean;
  status: number;
  json: unknown;
  headers?: Record<string, string>;
}) {
  return {
    ok: params.ok,
    status: params.status,
    json: async () => params.json,
    headers: {
      get: (name: string) => params.headers?.[name.toLowerCase()] ?? null
    }
  };
}

describe("telegram publisher", () => {
  it("sends parse_mode and disable_web_page_preview", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      buildResponse({
        ok: true,
        status: 200,
        json: { ok: true, result: { message_id: 123 } }
      })
    );

    const publisher = createTelegramPublisher({
      bot_token: "token",
      publishConfig: {
        channel_chat_id: "-100123",
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
        strategy: "auto"
      },
      fetch: fetchSpy
    });

    const result = await publisher.publishToChannel("hello");
    expect(result.message_id).toBe("123");

    const requestBody = JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string);
    expect(requestBody.parse_mode).toBe("MarkdownV2");
    expect(requestBody.disable_web_page_preview).toBe(true);
  });

  it("retries on 429 with retry_after", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        buildResponse({
          ok: false,
          status: 429,
          json: { ok: false, parameters: { retry_after: 1 } }
        })
      )
      .mockResolvedValueOnce(
        buildResponse({
          ok: true,
          status: 200,
          json: { ok: true, result: { message_id: "abc" } }
        })
      );

    const sleepSpy = vi.fn(async () => undefined);

    const publisher = createTelegramPublisher({
      bot_token: "token",
      publishConfig: {
        channel_chat_id: "-100123",
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        strategy: "auto"
      },
      fetch: fetchSpy,
      retries: 1,
      sleep: sleepSpy
    });

    const result = await publisher.publishToChannel("hello");
    expect(result.message_id).toBe("abc");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(1000);
  });

  it("queues publishes to respect min interval", async () => {
    let current = 0;
    const now = () => current;
    const sleep = vi.fn(async (ms: number) => {
      current += ms;
    });

    const fetchSpy = vi.fn().mockResolvedValue(
      buildResponse({
        ok: true,
        status: 200,
        json: { ok: true, result: { message_id: "1" } }
      })
    );

    const publisher = createTelegramPublisher({
      bot_token: "token",
      publishConfig: {
        channel_chat_id: "-100123",
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        strategy: "auto"
      },
      fetch: fetchSpy,
      minIntervalMs: 50,
      retries: 0,
      now,
      sleep
    });

    await Promise.all([
      publisher.publishToChannel("first"),
      publisher.publishToChannel("second")
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });
});
