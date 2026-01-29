import type { SqliteDatabase } from "./db.js";

export type EvidenceRecord = {
  evidence_id: string;
  slug: string;
  lane?: string | null;
  source_type?: string | null;
  url?: string | null;
  domain?: string | null;
  published_at?: string | null;
  claim?: string | null;
  stance?: string | null;
  novelty?: string | null;
  strength?: number | null;
  repeated?: boolean | null;
};

export function appendEvidence(db: SqliteDatabase, records: EvidenceRecord[]): void {
  if (records.length === 0) {
    return;
  }

  const stmt = db.prepare(
    `INSERT INTO evidence (
      evidence_id,
      slug,
      lane,
      source_type,
      url,
      domain,
      published_at,
      claim,
      stance,
      novelty,
      strength,
      repeated
    ) VALUES (
      @evidence_id,
      @slug,
      @lane,
      @source_type,
      @url,
      @domain,
      @published_at,
      @claim,
      @stance,
      @novelty,
      @strength,
      @repeated
    )`
  );

  const insertMany = db.transaction((items: EvidenceRecord[]) => {
    for (const record of items) {
      stmt.run({
        ...record,
        repeated:
          typeof record.repeated === "boolean"
            ? record.repeated
              ? 1
              : 0
            : record.repeated ?? null
      });
    }
  });

  insertMany(records);
}
