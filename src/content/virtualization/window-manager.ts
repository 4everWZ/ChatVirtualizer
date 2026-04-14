import type { ExtensionConfig, QARecord, RestoreRange, SessionState, WindowPlan } from '@/shared/contracts';

const LIVE_HOT_WINDOW_SIZE = 4;

interface WindowPlanOptions {
  forcedLiveRecordIds?: Iterable<string>;
  preferredLiveOrder?: readonly string[];
}

export function computeWindowPlan(
  records: QARecord[],
  config: ExtensionConfig,
  now: number,
  options: WindowPlanOptions = {}
): WindowPlan {
  const safeWindowSize = Math.max(1, Math.trunc(config.windowSizeQa));
  const protectedIds = new Set(records.filter((record) => isProtectedRecord(record, now)).map((record) => record.id));
  const preferredTailIds = new Set(
    records
      .filter((record) => !isProtectedRecord(record, now))
      .slice(-safeWindowSize)
      .map((record) => record.id)
  );
  let mountRecordIds = records
    .filter((record) => preferredTailIds.has(record.id) || protectedIds.has(record.id))
    .map((record) => record.id);

  if (records.length > 0 && mountRecordIds.length === 0) {
    mountRecordIds = records.slice(-Math.min(safeWindowSize, records.length)).map((record) => record.id);
  }

  const mountSet = new Set(mountRecordIds);
  const forcedLiveIds = new Set(Array.from(options.forcedLiveRecordIds ?? []).filter((recordId) => mountSet.has(recordId)));
  const protectedVisibleIds = mountRecordIds.filter((recordId) => protectedIds.has(recordId));
  const preferredLiveIds = getPreferredLiveIds(mountSet, forcedLiveIds, options.preferredLiveOrder ?? []);
  const remainingHotSlots = Math.max(0, LIVE_HOT_WINDOW_SIZE - preferredLiveIds.size);
  const fallbackTailLiveIds =
    remainingHotSlots === 0
      ? []
      : records
          .filter((record) => mountSet.has(record.id) && !protectedIds.has(record.id) && !forcedLiveIds.has(record.id) && !preferredLiveIds.has(record.id))
          .slice(-remainingHotSlots)
          .map((record) => record.id);
  const liveRecordIds = uniqueRecordIds([...protectedVisibleIds, ...forcedLiveIds, ...preferredLiveIds, ...fallbackTailLiveIds]);
  const liveSet = new Set(liveRecordIds);
  const liteRecordIds = mountRecordIds.filter((recordId) => !liveSet.has(recordId));
  const evictRecordIds = records
    .filter((record) => record.mounted && !mountSet.has(record.id))
    .map((record) => record.id);

  return {
    mountRecordIds,
    liveRecordIds,
    liteRecordIds,
    evictRecordIds
  };
}

function isProtectedRecord(record: QARecord, now: number): boolean {
  return record.generating || (record.protectedUntil !== undefined && record.protectedUntil > now);
}

function getPreferredLiveIds(
  mountSet: Set<string>,
  forcedLiveIds: Set<string>,
  preferredLiveOrder: readonly string[]
): Set<string> {
  const preferredVisible = preferredLiveOrder.filter((recordId) => mountSet.has(recordId) && !forcedLiveIds.has(recordId));
  const budgetedPreferred = preferredVisible.slice(-LIVE_HOT_WINDOW_SIZE);

  return new Set(budgetedPreferred);
}

function uniqueRecordIds(recordIds: string[]): string[] {
  return Array.from(new Set(recordIds));
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
