export type BotConfig = {
  admin_user_ids: number[];
};

export type TelegramBotConfig = BotConfig & {
  bot_token: string;
};

function normalizeAdminUserIds(ids: number[]): number[] {
  const normalized = ids.map((id) => Number(id));
  if (normalized.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("admin_user_ids must contain positive integers");
  }
  return Array.from(new Set(normalized));
}

export function validateConfig(raw: Partial<BotConfig>): BotConfig {
  if (!raw.admin_user_ids || raw.admin_user_ids.length === 0) {
    throw new Error("admin_user_ids is required");
  }

  return {
    admin_user_ids: normalizeAdminUserIds(raw.admin_user_ids)
  };
}

export function validateTelegramConfig(
  raw: Partial<TelegramBotConfig>
): TelegramBotConfig {
  const base = validateConfig(raw);
  const token = raw.bot_token?.trim();
  if (!token) {
    throw new Error("bot_token is required");
  }

  return {
    ...base,
    bot_token: token
  };
}
