import type { EvidenceConfig, TavilyConfig, PublishConfig } from "./config.schema.js";

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
      enabled: "always",
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

export const DEFAULT_EVIDENCE_CONFIG: EvidenceConfig = {
  novelty: {
    new_within_hours: 48,
    priced_after_hours: 72,
    price_change_24h_pct: 8,
    min_repeat_sources: 3,
    recency_keywords: [
      "today",
      "just",
      "breaking",
      "minutes ago",
      "just now"
    ]
  }
};

export const DEFAULT_PUBLISH_CONFIG: PublishConfig = {
  strategy: "approve",
  parse_mode: "Markdown",
  disable_web_page_preview: true
};
