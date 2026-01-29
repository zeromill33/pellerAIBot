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
    ...record,
    regenerate_count_1h:
      typeof record.regenerate_count_1h === "number"
        ? Math.floor(record.regenerate_count_1h)
        : record.regenerate_count_1h ?? null
  });
}
