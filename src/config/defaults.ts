import type { TavilyConfig } from "./config.schema.js";

export const DEFAULT_TAVILY_CONFIG: TavilyConfig = {
  default: {
    include_raw_content: true,
    include_answer: false,
    auto_parameters: true
  },
  rate_limit: {
    qps: 2,
    burst: 4
  },
  lanes: {
    A_update: {
      search_depth: "basic",
      max_results: 5,
      time_range: "7d"
    },
    B_primary: {
      search_depth: "basic",
      max_results: 5,
      time_range: "30d",
      include_domains: [],
      exclude_domains: []
    },
    C_counter: {
      search_depth: "advanced",
      max_results: 5,
      time_range: "30d"
    },
    D_chatter: {
      enabled: "conditional",
      search_depth: "basic",
      max_results: 3,
      time_range: "7d",
      triggers: {
        odds_change_24h_pct: 10,
        social_categories: ["crypto", "politics"],
        disagreement_insufficient: true
      },
      queries: [
        {
          name: "reddit",
          template: "site:reddit.com {event_keywords} (thread OR discussion OR megathread)"
        },
        {
          name: "x",
          template: "site:x.com {event_keywords} (rumor OR confirmed OR source)"
        },
        {
          name: "controversy",
          template: "{event_keywords} controversy resolution criteria"
        }
      ]
    }
  }
};
