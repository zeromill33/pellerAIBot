import { DEFAULT_TAVILY_CONFIG } from "./defaults.js";

export type BotConfig = {
  admin_user_ids: number[];
};

export type TelegramBotConfig = BotConfig & {
  bot_token: string;
};

export type TavilySearchDepth = "basic" | "advanced";

export type TavilyDefaultParams = {
  include_raw_content: boolean;
  include_answer: boolean;
  auto_parameters: boolean;
};

export type TavilyLaneConfig = {
  search_depth: TavilySearchDepth;
  max_results: number;
  time_range: string;
  include_domains?: string[];
  exclude_domains?: string[];
};

export type TavilyChatterTrigger = {
  odds_change_24h_pct: number;
  social_categories: string[];
  disagreement_insufficient: boolean;
};

export type TavilyChatterQuery = {
  name: string;
  template: string;
};

export type TavilyChatterConfig = TavilyLaneConfig & {
  enabled: "conditional" | "always" | "never";
  triggers: TavilyChatterTrigger;
  queries: TavilyChatterQuery[];
};

export type TavilyLaneSet = {
  A_update: TavilyLaneConfig;
  B_primary: TavilyLaneConfig;
  C_counter: TavilyLaneConfig;
  D_chatter: TavilyChatterConfig;
};

export type TavilyConfig = {
  api_key?: string;
  default: TavilyDefaultParams;
  lanes: TavilyLaneSet;
};

function normalizeAdminUserIds(ids: number[]): number[] {
  const normalized = ids.map((id) => Number(id));
  if (normalized.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error("admin_user_ids must contain positive integers");
  }
  return Array.from(new Set(normalized));
}

function normalizeBoolean(value: boolean | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveInt(
  value: number | undefined,
  fallback: number,
  label: string
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeSearchDepth(
  value: TavilySearchDepth | undefined,
  fallback: TavilySearchDepth,
  label: string
): TavilySearchDepth {
  if (value === undefined) {
    return fallback;
  }
  if (value !== "basic" && value !== "advanced") {
    throw new Error(`${label} must be basic or advanced`);
  }
  return value;
}

function normalizeTimeRange(
  value: string | undefined,
  fallback: string,
  label: string
): string {
  if (value === undefined) {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return trimmed;
}

function normalizeStringArray(
  value: string[] | undefined,
  fallback: string[] | undefined,
  label: string
): string[] | undefined {
  if (value === undefined) {
    return fallback ? [...fallback] : undefined;
  }
  const normalized = value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0 && value.length > 0) {
    throw new Error(`${label} must contain non-empty strings`);
  }
  return normalized;
}

function normalizeChatterQueries(
  value: TavilyChatterQuery[] | undefined,
  fallback: TavilyChatterQuery[],
  label: string
): TavilyChatterQuery[] {
  if (value === undefined) {
    return fallback.map((query) => ({ ...query }));
  }
  if (value.length === 0) {
    throw new Error(`${label} must contain at least one query`);
  }
  const normalized = value
    .map((query) => ({
      name: query.name.trim(),
      template: query.template.trim()
    }))
    .filter((query) => query.name.length > 0 && query.template.length > 0);
  if (normalized.length === 0) {
    throw new Error(`${label} must contain valid queries`);
  }
  return normalized;
}

function normalizeChatterTriggers(
  value: TavilyChatterTrigger | undefined,
  fallback: TavilyChatterTrigger,
  label: string
): TavilyChatterTrigger {
  if (!value) {
    return { ...fallback };
  }
  const oddsChange =
    typeof value.odds_change_24h_pct === "number" && value.odds_change_24h_pct > 0
      ? value.odds_change_24h_pct
      : fallback.odds_change_24h_pct;
  const categories = normalizeStringArray(
    value.social_categories,
    fallback.social_categories,
    `${label}.social_categories`
  );
  return {
    odds_change_24h_pct: oddsChange,
    social_categories: categories ?? [],
    disagreement_insufficient: normalizeBoolean(
      value.disagreement_insufficient,
      fallback.disagreement_insufficient
    )
  };
}

function normalizeLaneConfig(
  base: TavilyLaneConfig,
  value: Partial<TavilyLaneConfig> | undefined,
  label: string
): TavilyLaneConfig {
  return {
    search_depth: normalizeSearchDepth(
      value?.search_depth,
      base.search_depth,
      `${label}.search_depth`
    ),
    max_results: normalizePositiveInt(
      value?.max_results,
      base.max_results,
      `${label}.max_results`
    ),
    time_range: normalizeTimeRange(
      value?.time_range,
      base.time_range,
      `${label}.time_range`
    ),
    include_domains: normalizeStringArray(
      value?.include_domains,
      base.include_domains,
      `${label}.include_domains`
    ),
    exclude_domains: normalizeStringArray(
      value?.exclude_domains,
      base.exclude_domains,
      `${label}.exclude_domains`
    )
  };
}

function normalizeChatterConfig(
  base: TavilyChatterConfig,
  value: Partial<TavilyChatterConfig> | undefined,
  label: string
): TavilyChatterConfig {
  const enabled = value?.enabled ?? base.enabled;
  if (!["conditional", "always", "never"].includes(enabled)) {
    throw new Error(`${label}.enabled must be conditional, always, or never`);
  }
  return {
    ...normalizeLaneConfig(base, value, label),
    enabled,
    triggers: normalizeChatterTriggers(
      value?.triggers,
      base.triggers,
      `${label}.triggers`
    ),
    queries: normalizeChatterQueries(value?.queries, base.queries, `${label}.queries`)
  };
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

export function validateTavilyConfig(
  raw: Partial<TavilyConfig> = {}
): TavilyConfig {
  const defaults = DEFAULT_TAVILY_CONFIG;
  const defaultParams = raw.default ?? {};
  const apiKey = raw.api_key?.trim();

  return {
    api_key: apiKey ? apiKey : undefined,
    default: {
      include_raw_content: normalizeBoolean(
        defaultParams.include_raw_content,
        defaults.default.include_raw_content
      ),
      include_answer: normalizeBoolean(
        defaultParams.include_answer,
        defaults.default.include_answer
      ),
      auto_parameters: normalizeBoolean(
        defaultParams.auto_parameters,
        defaults.default.auto_parameters
      )
    },
    lanes: {
      A_update: normalizeLaneConfig(
        defaults.lanes.A_update,
        raw.lanes?.A_update,
        "lanes.A_update"
      ),
      B_primary: normalizeLaneConfig(
        defaults.lanes.B_primary,
        raw.lanes?.B_primary,
        "lanes.B_primary"
      ),
      C_counter: normalizeLaneConfig(
        defaults.lanes.C_counter,
        raw.lanes?.C_counter,
        "lanes.C_counter"
      ),
      D_chatter: normalizeChatterConfig(
        defaults.lanes.D_chatter,
        raw.lanes?.D_chatter,
        "lanes.D_chatter"
      )
    }
  };
}
