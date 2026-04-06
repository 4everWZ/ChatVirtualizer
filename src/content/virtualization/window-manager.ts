import type { ExtensionConfig, QARecord, RestoreRange, SessionState, WindowPlan } from '@/shared/contracts';

export function computeWindowPlan(records: QARecord[], config: ExtensionConfig, now: number): WindowPlan {
  const protectedIds = new Set(records.filter((record) => isProtectedRecord(record, now)).map((record) => record.id));
  const preferredTailIds = new Set(
    records
      .filter((record) => !isProtectedRecord(record, now))
      .slice(-config.windowSizeQa)
      .map((record) => record.id)
  );

  const mountRecordIds = records.filter((record) => preferredTailIds.has(record.id) || protectedIds.has(record.id)).map((record) => record.id);

  const mountSet = new Set(mountRecordIds);

  const evictRecordIds = records
    .filter((record) => record.mounted && !mountSet.has(record.id))
    .map((record) => record.id);

  return {
    mountRecordIds,
    evictRecordIds
  };
}

function isProtectedRecord(record: QARecord, now: number): boolean {
  return record.generating || (record.protectedUntil !== undefined && record.protectedUntil > now);
}

export function getTopRestoreRange(
  sessionState: Pick<SessionState, 'activeWindowEnd' | 'activeWindowStart' | 'totalRecords'>,
  config: Pick<ExtensionConfig, 'loadBatchQa'>
): RestoreRange | null {
  if (sessionState.totalRecords === 0 || sessionState.activeWindowStart <= 0) {
    return null;
  }

  const end = sessionState.activeWindowStart - 1;
  const start = Math.max(0, end - config.loadBatchQa + 1);

  return { end, start };
}
