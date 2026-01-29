import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "./db.js";

function ensureMigrationsTable(db: SqliteDatabase) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, run_at TEXT NOT NULL)"
  );
}

function loadAppliedMigrations(db: SqliteDatabase): Set<string> {
  const rows = db.prepare("SELECT name FROM _migrations").all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function readMigrationFiles(migrationsPath: string): string[] {
  if (!fs.existsSync(migrationsPath)) {
    return [];
  }
  return fs
    .readdirSync(migrationsPath)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function runMigrations(
  db: SqliteDatabase,
  migrationsPath = path.join(process.cwd(), "migrations")
): void {
  ensureMigrationsTable(db);
  const applied = loadAppliedMigrations(db);
  const files = readMigrationFiles(migrationsPath);
  if (files.length === 0) {
    return;
  }

  const insert = db.prepare("INSERT INTO _migrations (name, run_at) VALUES (?, ?)");
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsPath, file), "utf-8");
    const runAt = new Date().toISOString();
    const apply = db.transaction(() => {
      if (file === "003_add_price_fields.sql") {
        const statements = sql
          .split(";")
          .map((statement) => statement.trim())
          .filter((statement) => statement.length > 0);
        for (const statement of statements) {
          try {
            db.exec(statement);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("duplicate column name")) {
              continue;
            }
            throw error;
          }
        }
      } else {
        db.exec(sql);
      }
      insert.run(file, runAt);
    });
    apply();
  }
}
