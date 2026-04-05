import { DEFAULT_CONFIG, mergeConfig } from '@/shared/config';

describe('config defaults', () => {
  test('mergeConfig preserves overrides and fills missing defaults', () => {
    const merged = mergeConfig({
      loadBatchQa: 3,
      enableSearch: false
    });

    expect(merged.windowSizeQa).toBe(DEFAULT_CONFIG.windowSizeQa);
    expect(merged.loadBatchQa).toBe(3);
    expect(merged.enableSearch).toBe(false);
    expect(merged.maxPersistedSessions).toBe(5);
  });
});
