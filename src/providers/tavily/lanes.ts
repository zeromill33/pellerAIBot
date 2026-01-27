import { validateTavilyConfig } from "../../config/config.schema.js";
import type {
  TavilyConfig,
  TavilyConfigInput,
  TavilyDefaultParams,
  TavilyLaneConfig,
  TavilySearchDepth
} from "../../config/config.schema.js";

export type TavilyLaneId = "A" | "B" | "C" | "D";

export type TavilyLaneParams = TavilyDefaultParams & {
  lane: TavilyLaneId;
  search_depth: TavilySearchDepth;
  max_results: number;
  time_range: string;
  include_domains?: string[];
  exclude_domains?: string[];
};

function selectLaneConfig(
  config: TavilyConfig,
  lane: TavilyLaneId
): TavilyLaneConfig {
  switch (lane) {
    case "A":
      return config.lanes.A_update;
    case "B":
      return config.lanes.B_primary;
    case "C":
      return config.lanes.C_counter;
    case "D":
      return config.lanes.D_chatter;
    default:
      return config.lanes.A_update;
  }
}

export function buildTavilyLaneParams(
  lane: TavilyLaneId,
  rawConfig: TavilyConfigInput = {}
): TavilyLaneParams {
  const config = validateTavilyConfig(rawConfig);
  const laneConfig = selectLaneConfig(config, lane);
  const defaults = config.default;

  return {
    lane,
    search_depth: laneConfig.search_depth,
    max_results: laneConfig.max_results,
    time_range: laneConfig.time_range,
    include_domains: laneConfig.include_domains
      ? [...laneConfig.include_domains]
      : undefined,
    exclude_domains: laneConfig.exclude_domains
      ? [...laneConfig.exclude_domains]
      : undefined,
    include_raw_content: defaults.include_raw_content,
    include_answer: defaults.include_answer,
    auto_parameters: defaults.auto_parameters
  };
}
