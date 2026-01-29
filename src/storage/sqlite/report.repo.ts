import type { SqliteDatabase } from "./db.js";

export type ReportRecord = {
  report_id: string;
  slug: string;
  generated_at: string;
  report_json?: string | null;
  tg_post_text?: string | null;
  status: string;
  validator_code?: string | null;
  validator_message?: string | null;
  regenerate_count_1h?: number | null;
  tg_message_id?: string | null;
  reviewer?: string | null;
};

export type ReportStatusRecord = {
  report_id: string;
  slug: string;
  generated_at: string;
  status: string;
  validator_code: string | null;
  validator_message: string | null;
};

export type ReportPublishUpdate = {
  report_id: string;
  status: string;
  tg_message_id: string;
};

export function saveReport(db: SqliteDatabase, record: ReportRecord): void {
  const stmt = db.prepare(
    `INSERT INTO report (
      report_id,
      slug,
      generated_at,
      report_json,
      tg_post_text,
      status,
      validator_code,
      validator_message,
      regenerate_count_1h,
      tg_message_id,
      reviewer
    ) VALUES (
      @report_id,
      @slug,
      @generated_at,
      @report_json,
      @tg_post_text,
      @status,
      @validator_code,
      @validator_message,
      @regenerate_count_1h,
      @tg_message_id,
      @reviewer
    )`
  );

  stmt.run({
    report_id: record.report_id,
    slug: record.slug,
    generated_at: record.generated_at,
    report_json: record.report_json ?? null,
    tg_post_text: record.tg_post_text ?? null,
    status: record.status,
    validator_code: record.validator_code ?? null,
    validator_message: record.validator_message ?? null,
    regenerate_count_1h:
      typeof record.regenerate_count_1h === "number"
        ? Math.floor(record.regenerate_count_1h)
        : record.regenerate_count_1h ?? null,
    tg_message_id: record.tg_message_id ?? null,
    reviewer: record.reviewer ?? null
  });
}

export function getLatestReport(
  db: SqliteDatabase,
  slug: string
): ReportStatusRecord | null {
  const row = db
    .prepare(
      `SELECT report_id, slug, generated_at, status, validator_code, validator_message
       FROM report
       WHERE slug = ?
       ORDER BY generated_at DESC, report_id DESC
       LIMIT 1`
    )
    .get(slug) as ReportStatusRecord | undefined;

  return row ?? null;
}

export function updateReportPublish(
  db: SqliteDatabase,
  update: ReportPublishUpdate
): void {
  db.prepare(
    `UPDATE report
     SET status = @status,
         tg_message_id = @tg_message_id
     WHERE report_id = @report_id`
  ).run(update);
}
