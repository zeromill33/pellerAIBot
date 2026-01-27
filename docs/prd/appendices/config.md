# 附录 A：配置文件规范（含限流规则）

建议使用 `config.yaml`（或 `config.json`）。以下为最小可用示例（Week 1）：

```yaml
env: prod

telegram:
  bot_token: "TG_BOT_TOKEN"
  channel_chat_id: "-100xxxxxxxxxx"   # Telegram Channel chat id
  parse_mode: "Markdown"              # 或 MarkdownV2 / HTML
  disable_web_page_preview: true

tavily:
  api_key: "TAVILY_API_KEY"
  default:
    include_raw_content: true
    include_answer: false
    auto_parameters: true
  lanes:
    A_update:
      search_depth: "basic"
      max_results: 5
      time_range: "7d"
    B_primary:
      search_depth: "basic"
      max_results: 5
      time_range: "30d"
      include_domains: []             # 可选：按事件动态覆盖
      exclude_domains: []             # 可选：黑名单
    C_counter:
      search_depth: "advanced"        # 仅此车道默认 advanced（如要更省额度可改 basic）
      max_results: 5
      time_range: "30d"
    D_chatter:
      enabled: "always"               # 默认启用；如需节省额度可改为 conditional/never
      search_depth: "basic"
      max_results: 3
      time_range: "7d"
      triggers:
        odds_change_24h_pct: 10       # 赔率 24h 波动阈值（示例）
        social_categories: ["crypto", "politics"]
        disagreement_insufficient: true
      queries:                        # 触发时必须执行全部不同类型查询
        - name: "reddit"
          template: "site:reddit.com {event_keywords} (thread OR discussion OR megathread)"
        - name: "x"
          template: "site:x.com {event_keywords} (rumor OR confirmed OR source)"
        - name: "controversy"
          template: "{event_keywords} controversy resolution criteria"

rate_limit:
  regenerate:
    per_event:
      min_interval_seconds: 300       # 5 分钟内同事件最多一次
    per_hour:
      max_requests: 5                 # 1 小时最多 5 次（同事件）
  tavily:
    qps: 1                            # Tavily 全局 qps（按额度调）
    burst: 2

cache:
  enabled: true
  key_strategy: "event_slug+day+lane+query_hash"
  ttl_seconds: 86400                  # 同一天缓存
```

---
