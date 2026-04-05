import type { ExtensionConfig, QARecord, RestoreRange, SessionState, WindowPlan } from '@/shared/contracts';

export function computeWindowPlan(records: QARecord[], config: ExtensionConfig, now: number): WindowPlan {
  const preferredStart = Math.max(records.length - config.windowSizeQa, 0);
  const protectedIds = new Set(
    records
      .filter((record) => record.generating || (record.protectedUntil !== undefined && record.protectedUntil > now))
      .map((record) => record.id)
  );

  const mountRecordIds = records
    .filter((record, index) => index >= preferredStart || protectedIds.has(record.id))
    .map((record) => record.id);

  const mountSet = new Set(mountRecordIds);

  const evictRecordIds = records
    .filter((record) => record.mounted && !mountSet.has(record.id))
    .map((record) => record.id);

  return {
    mountRecordIds,
    evictRecordIds
  };
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
