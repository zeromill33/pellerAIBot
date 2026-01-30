import { describe, expect, it } from "vitest";
import { fetchOfficialSource } from "../../src/orchestrator/steps/official.fetch.step.js";

describe("official.fetch step", () => {
  it("extracts title and snippet from resolver html", async () => {
    const html = `
      <html>
        <head>
          <title>Official Resolution Page</title>
          <meta property="article:published_time" content="2026-01-02T00:00:00Z" />
        </head>
        <body>
          <h1>Official Update</h1>
          <p>Some official details about the resolution.</p>
        </body>
      </html>
    `;
    const fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => html
    });

    const result = await fetchOfficialSource({
      event_slug: "event-1",
      resolver_url: "https://official.example.com/resolution"
    }, { fetch });

    expect(result.official_sources).toHaveLength(1);
    expect(result.official_sources[0]?.title).toBe("Official Resolution Page");
    expect(result.official_sources[0]?.published_at).toBe("2026-01-02T00:00:00Z");
    expect(result.official_sources[0]?.snippet).toContain("official details");
  });

  it("returns error when resolver url missing", async () => {
    const result = await fetchOfficialSource({
      event_slug: "event-2",
      resolver_url: null
    });

    expect(result.official_sources).toEqual([]);
    expect(result.official_sources_error).toBe("resolver_url_missing");
  });

  it("returns error when request fails", async () => {
    const fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => ""
    });

    const result = await fetchOfficialSource({
      event_slug: "event-3",
      resolver_url: "https://official.example.com/resolution"
    }, { fetch });

    expect(result.official_sources).toEqual([]);
    expect(result.official_sources_error).toBe("request_failed:404");
  });
});
