import { DEFAULT_CONFIG, mergeConfig } from '@/shared/config';

describe('config defaults', () => {
  test('mergeConfig preserves overrides and fills missing defaults', () => {
    const merged = mergeConfig({
      loadBatchQa: 3,
      enableVirtualization: false
    });

    expect(merged.windowSizeQa).toBe(DEFAULT_CONFIG.windowSizeQa);
    expect(merged.loadBatchQa).toBe(3);
    expect('enableSearch' in merged).toBe(false);
    expect(merged.enableVirtualization).toBe(false);
    expect(merged.maxPersistedSessions).toBe(5);
  });

  test('mergeConfig clamps invalid numeric window values back to safe minimums', () => {
    const merged = mergeConfig({
      windowSizeQa: -10,
      loadBatchQa: 0,
      searchContextBefore: -1,
      searchContextAfter: -1,
      maxPersistedSessions: 0,
      stabilityQuietMs: -100
    });

    expect(merged.windowSizeQa).toBe(1);
    expect(merged.loadBatchQa).toBe(1);
    expect(merged.searchContextBefore).toBe(0);
    expect(merged.searchContextAfter).toBe(0);
    expect(merged.maxPersistedSessions).toBe(1);
    expect(merged.stabilityQuietMs).toBe(0);
  });
});
