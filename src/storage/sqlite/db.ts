import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type SqliteDatabase = Database.Database;

export type SqliteOpenOptions = {
  filename?: string;
  migrationsPath?: string;
  enableWAL?: boolean;
};

function resolveFilename(filename?: string): string {
  const envPath = process.env.SQLITE_PATH?.trim();
  if (filename && filename.trim().length > 0) {
    return filename.trim();
  }
  if (envPath) {
    return envPath;
  }
  return path.join(process.cwd(), "data", "peller-ai.sqlite");
}

export function openSqliteDatabase(options: SqliteOpenOptions = {}): SqliteDatabase {
  const filename = resolveFilename(options.filename);
  if (filename !== ":memory:") {
    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  if (options.enableWAL !== false) {
    db.pragma("journal_mode = WAL");
  }

  runMigrations(db, options.migrationsPath);
  return db;
}
