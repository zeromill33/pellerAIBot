-- Indexes for event/evidence/report tables

CREATE INDEX IF NOT EXISTS idx_evidence_slug ON evidence(slug);
CREATE INDEX IF NOT EXISTS idx_report_slug ON report(slug);
CREATE INDEX IF NOT EXISTS idx_report_status ON report(status);
CREATE INDEX IF NOT EXISTS idx_report_generated_at ON report(generated_at);
