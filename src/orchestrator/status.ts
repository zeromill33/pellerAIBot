import { createAppError, ERROR_CODES } from "./errors.js";
import { getDefaultSqliteStorageAdapter, type StorageAdapter, type ReportStatusRecord } from "../storage/index.js";

export type StatusQuery = {
  slug: string;
};

export type StatusResult = ReportStatusRecord;

export type StatusOptions = {
  storage?: StorageAdapter;
};

export async function getLatestStatus(
  input: StatusQuery,
  options: StatusOptions = {}
): Promise<StatusResult> {
  const slug = input.slug.trim();
  const storage = options.storage ?? getDefaultSqliteStorageAdapter();
  const report = storage.getLatestReport(slug);
  if (!report) {
    throw createAppError({
      code: ERROR_CODES.ORCH_STATUS_NOT_FOUND,
      message: "未找到该事件/暂无报告",
      category: "STORE",
      retryable: false,
      details: { slug }
    });
  }
  return report;
}
