import { createAppError, ERROR_CODES } from "../orchestrator/errors.js";

export function guardAdminUser(userId: number, adminUserIds: number[]): void {
  const normalized = adminUserIds.filter((id) => Number.isFinite(id));
  if (!normalized.includes(userId)) {
    throw createAppError({
      code: ERROR_CODES.BOT_UNAUTHORIZED,
      message: "User is not authorized to run this command",
      category: "VALIDATION",
      retryable: false,
      details: { user_id: userId }
    });
  }
}

export function guardPublishUrls(urls: string[]): void {
  const cleaned = urls.map((url) => url.trim()).filter(Boolean);

  if (cleaned.length === 0) {
    throw createAppError({
      code: ERROR_CODES.BOT_EMPTY_URL_LIST,
      message: "No URLs provided",
      category: "VALIDATION",
      retryable: false
    });
  }

  const hasLikelyUrl = cleaned.some((url) => /^https?:\/\//i.test(url));
  if (!hasLikelyUrl) {
    throw createAppError({
      code: ERROR_CODES.BOT_INVALID_URL,
      message: "No valid URL tokens found",
      category: "VALIDATION",
      retryable: false,
      details: { input: cleaned }
    });
  }
}
