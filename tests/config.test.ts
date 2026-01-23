import { describe, it, expect } from "vitest";
import {
  validateConfig,
  validateTelegramConfig
} from "../src/config/config.schema.js";
import { parseAdminUserIds } from "../src/config/load.js";

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
