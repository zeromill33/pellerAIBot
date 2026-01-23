# 附录 G：SentimentProvider 方案 1 ——NewsData.io（占位接口 + 成本/效果预期）

> Week 1 默认关闭。这里给接口与工程落地点，避免未来返工。

- 优势：结构化 JSON、聚合多来源新闻/社交信号（取决于套餐）
- 风险：对 X/Twitter 的覆盖常受官方 API 政策影响；需要你们在接入前做一次“覆盖验证”。

最小接口（占位）：

```ts
export interface SentimentProvider {
  getSentiment(input: {
    query: string;
    windowHours: number;
    sources?: string[]; // e.g. ["reddit","x","news"]
  }): Promise<{
    overall: "bullish" | "bearish" | "neutral";
    score: number; // -1..1
    topKeywords: string[];
    samples: Array<{ source: string; url?: string; text: string; ts?: string }>;
  }>;
}
```

---
