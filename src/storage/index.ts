import { createRequire } from "node:module";
import type {
  StorageAdapter,
  EventRecord,
  EvidenceRecord,
  ReportRecord,
  ReportStatusRecord,
  ReportPublishUpdate,
  ReportStatusUpdate,
  SqliteStorageOptions
} from "./sqlite/index.js";
import type { SqliteDatabase, SqliteOpenOptions } from "./sqlite/db.js";

const require = createRequire(import.meta.url);

function loadSqliteIndex() {
  return require("./sqlite/index.js") as typeof import("./sqlite/index.js");
}

function loadSqliteDb() {
  return require("./sqlite/db.js") as typeof import("./sqlite/db.js");
}

function createSqliteStorageAdapter(
  options: SqliteStorageOptions = {}
): StorageAdapter {
  return loadSqliteIndex().createSqliteStorageAdapter(options);
}

function getDefaultSqliteStorageAdapter(): StorageAdapter {
  return loadSqliteIndex().getDefaultSqliteStorageAdapter();
}

function openSqliteDatabase(options?: SqliteOpenOptions): SqliteDatabase {
  return loadSqliteDb().openSqliteDatabase(options);
}

export {
  createSqliteStorageAdapter,
  getDefaultSqliteStorageAdapter,
  openSqliteDatabase
};
export type {
  StorageAdapter,
  EventRecord,
  EvidenceRecord,
  ReportRecord,
  ReportStatusRecord,
  ReportPublishUpdate,
  ReportStatusUpdate,
  SqliteStorageOptions,
  SqliteDatabase,
  SqliteOpenOptions
};
