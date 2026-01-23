import { describe, it, expect } from "vitest";
import { guardPublishUrls } from "../src/bot/guard.js";
import { AppError, ERROR_CODES } from "../src/orchestrator/errors.js";

describe("guardPublishUrls", () => {
  it("throws when URL list is empty", () => {
    try {
      guardPublishUrls([]);
      throw new Error("Expected guard to throw");
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe(ERROR_CODES.BOT_EMPTY_URL_LIST);
    }
  });

  it("throws when no URL-like tokens exist", () => {
    try {
      guardPublishUrls(["abc", "def"]);
      throw new Error("Expected guard to throw");
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe(ERROR_CODES.BOT_INVALID_URL);
    }
  });
});
