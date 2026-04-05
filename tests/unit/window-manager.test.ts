import { DEFAULT_CONFIG } from '@/shared/config';
import type { QARecord } from '@/shared/contracts';
import { computeWindowPlan, getTopRestoreRange } from '@/content/virtualization/window-manager';

function record(index: number, overrides: Partial<QARecord> = {}): QARecord {
  return {
    id: `record-${index}`,
    index,
    sessionId: 'session-1',
    userTurnIds: [`user-${index}`],
    assistantTurnIds: [`assistant-${index}`],
    textUser: `Question ${index}`,
    textAssistant: `Answer ${index}`,
    textCombined: `Question ${index} Answer ${index}`,
    height: 120,
    mounted: true,
    stable: true,
    generating: false,
    protectedUntil: undefined,
    ...overrides
  };
}

describe('window manager', () => {
  test('keeps the latest qa window mounted while preserving protected records', () => {
    const records = Array.from({ length: 14 }, (_, index) => record(index));
    records[1] = record(1, { mounted: true, protectedUntil: Date.now() + 60_000 });
    records[13] = record(13, { generating: true, stable: false });

    const plan = computeWindowPlan(records, DEFAULT_CONFIG, Date.now());

    expect(plan.mountRecordIds).toContain('record-1');
    expect(plan.mountRecordIds).toContain('record-13');
    expect(plan.evictRecordIds).toContain('record-0');
    expect(plan.mountRecordIds).toHaveLength(11);
  });

  test('restores the previous batch when the user reaches the top', () => {
    const range = getTopRestoreRange({
      activeWindowStart: 10,
      activeWindowEnd: 14,
      totalRecords: 15
    }, DEFAULT_CONFIG);

    expect(range).toEqual({ start: 5, end: 9 });
  });
});
