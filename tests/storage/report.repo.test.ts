import { describe, it, expect, beforeEach } from "vitest";
import { openSqliteDatabase } from "../../src/storage/sqlite/db.js";
import {
  saveReport,
  getLatestReport,
  updateReportStatus
} from "../../src/storage/sqlite/report.repo.js";

let db: ReturnType<typeof openSqliteDatabase>;

beforeEach(() => {
  db = openSqliteDatabase({ filename: ":memory:" });
});

describe("getLatestReport", () => {
  it("returns latest report by generated_at", () => {
    db.prepare(
      "INSERT INTO event (slug, url, title, created_at) VALUES (?, ?, ?, ?)"
    ).run("alpha", "https://polymarket.com/event/alpha", "Alpha", "2026-01-28T00:00:00Z");

    saveReport(db, {
      report_id: "report_1",
      slug: "alpha",
      generated_at: "2026-01-28T00:00:00Z",
      status: "ready"
    });
    saveReport(db, {
      report_id: "report_2",
      slug: "alpha",
      generated_at: "2026-01-29T00:00:00Z",
      status: "blocked",
      validator_code: "VALIDATOR_SCHEMA_INVALID",
      validator_message: "Schema failed"
    });

    const latest = getLatestReport(db, "alpha");
    expect(latest).toEqual({
      report_id: "report_2",
      slug: "alpha",
      generated_at: "2026-01-29T00:00:00Z",
      status: "blocked",
      validator_code: "VALIDATOR_SCHEMA_INVALID",
      validator_message: "Schema failed"
    });
  });

  it("returns null when no reports", () => {
    const latest = getLatestReport(db, "missing");
    expect(latest).toBeNull();
  });
});

describe("updateReportStatus", () => {
  it("updates status and validator fields", () => {
    db.prepare(
      "INSERT INTO event (slug, url, title, created_at) VALUES (?, ?, ?, ?)"
    ).run("alpha", "https://polymarket.com/event/alpha", "Alpha", "2026-01-28T00:00:00Z");

    saveReport(db, {
      report_id: "report_1",
      slug: "alpha",
      generated_at: "2026-01-28T00:00:00Z",
      status: "ready"
    });

    updateReportStatus(db, {
      report_id: "report_1",
      status: "blocked",
      validator_code: "PROVIDER_TG_REQUEST_FAILED",
      validator_message: "rate limited"
    });

    const row = db
      .prepare(
        "SELECT status, validator_code, validator_message FROM report WHERE report_id = ?"
      )
      .get("report_1") as {
      status: string;
      validator_code: string | null;
      validator_message: string | null;
    };

    expect(row.status).toBe("blocked");
    expect(row.validator_code).toBe("PROVIDER_TG_REQUEST_FAILED");
    expect(row.validator_message).toBe("rate limited");
  });
});
