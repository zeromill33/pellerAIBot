import type { SqliteDatabase } from "./db.js";
import { openSqliteDatabase } from "./db.js";
import { upsertEvent, type EventRecord } from "./event.repo.js";
import { appendEvidence, type EvidenceRecord } from "./evidence.repo.js";
import {
  saveReport,
  getLatestReport,
  updateReportPublish,
  type ReportRecord,
  type ReportStatusRecord,
  type ReportPublishUpdate
} from "./report.repo.js";

export type StorageAdapter = {
  upsertEvent: (record: EventRecord) => void;
  appendEvidence: (records: EvidenceRecord[]) => void;
  saveReport: (record: ReportRecord) => void;
  getLatestReport: (slug: string) => ReportStatusRecord | null;
  updateReportPublish: (update: ReportPublishUpdate) => void;
  runInTransaction: (task: () => void) => void;
  close: () => void;
};

export type SqliteStorageOptions = {
  db?: SqliteDatabase;
  filename?: string;
  migrationsPath?: string;
};

export function createSqliteStorageAdapter(
  options: SqliteStorageOptions = {}
): StorageAdapter {
  const db = options.db ?? openSqliteDatabase({
    filename: options.filename,
    migrationsPath: options.migrationsPath
  });
  const runInTransaction = db.transaction((task: () => void) => task());

  return {
    upsertEvent: (record) => upsertEvent(db, record),
    appendEvidence: (records) => appendEvidence(db, records),
    saveReport: (record) => saveReport(db, record),
    getLatestReport: (slug) => getLatestReport(db, slug),
    updateReportPublish: (update) => updateReportPublish(db, update),
    runInTransaction: (task) => runInTransaction(task),
    close: () => db.close()
  };
}

let defaultAdapter: StorageAdapter | null = null;

export function getDefaultSqliteStorageAdapter(): StorageAdapter {
  if (process.env.NODE_ENV === "test") {
    return createSqliteStorageAdapter({ filename: ":memory:" });
  }
  if (!defaultAdapter) {
    defaultAdapter = createSqliteStorageAdapter();
  }
  return defaultAdapter;
}

export type {
  EventRecord,
  EvidenceRecord,
  ReportRecord,
  ReportStatusRecord,
  ReportPublishUpdate
};
