import { describe, it, expect } from "vitest";
import {
  validateConfig,
  validateTelegramConfig,
  validateTavilyConfig
} from "../src/config/config.schema.js";
import { loadTavilyConfig, parseAdminUserIds } from "../src/config/load.js";

describe("config validation", () => {
  it("fails when admin_user_ids is missing", () => {
    expect(() => validateConfig({})).toThrow("admin_user_ids");
  });

  it("fails when admin_user_ids is empty", () => {
    expect(() => validateConfig({ admin_user_ids: [] })).toThrow(
      "admin_user_ids"
    );
  });

  it("fails when admin_user_ids contains invalid values", () => {
    expect(() => validateConfig({ admin_user_ids: [0, -1] })).toThrow(
      "admin_user_ids"
    );
  });

  it("accepts valid admin_user_ids", () => {
    const config = validateConfig({ admin_user_ids: [1001, 1002] });
    expect(config.admin_user_ids).toEqual([1001, 1002]);
  });

  it("fails when telegram bot token is missing", () => {
    expect(() =>
      validateTelegramConfig({ admin_user_ids: [1001] })
    ).toThrow("bot_token");
  });

  it("accepts valid telegram config", () => {
    const config = validateTelegramConfig({
      admin_user_ids: [1001],
      bot_token: "test_token"
    });
    expect(config.bot_token).toBe("test_token");
  });
});

describe("parseAdminUserIds", () => {
  it("parses a comma separated list", () => {
    expect(parseAdminUserIds("1001, 1002")).toEqual([1001, 1002]);
  });

  it("returns empty list for empty input", () => {
    expect(parseAdminUserIds("")).toEqual([]);
  });
});

describe("tavily config validation", () => {
  it("applies defaults for tavily config", () => {
    const config = validateTavilyConfig();
    expect(config.default.include_raw_content).toBe(true);
    expect(config.default.include_answer).toBe(false);
    expect(config.default.auto_parameters).toBe(true);
    expect(config.rate_limit.qps).toBe(2);
    expect(config.rate_limit.burst).toBe(4);
    expect(config.lanes.A_update.search_depth).toBe("basic");
    expect(config.lanes.C_counter.search_depth).toBe("advanced");
  });

  it("allows config overrides", () => {
    const config = validateTavilyConfig({
      default: { include_raw_content: false },
      rate_limit: { qps: 3, burst: 6 },
      lanes: { A_update: { max_results: 9 } }
    });
    expect(config.default.include_raw_content).toBe(false);
    expect(config.rate_limit.qps).toBe(3);
    expect(config.rate_limit.burst).toBe(6);
    expect(config.lanes.A_update.max_results).toBe(9);
  });
});

describe("loadTavilyConfig", () => {
  it("loads api key from env", () => {
    const config = loadTavilyConfig({ TAVILY_API_KEY: "test_key" } as NodeJS.ProcessEnv);
    expect(config.api_key).toBe("test_key");
  });
});
