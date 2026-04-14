import type { ExtensionConfig } from './contracts';

export const DEFAULT_CONFIG: ExtensionConfig = {
  windowSizeQa: 10,
  loadBatchQa: 5,
  topThresholdPx: 24,
  preloadBufferPx: 2000,
  searchContextBefore: 1,
  searchContextAfter: 1,
  protectGenerating: true,
  enableVirtualization: true,
  debugLogging: false,
  maxPersistedSessions: 5,
  stabilityQuietMs: 1500
};

export function mergeConfig(overrides?: Partial<ExtensionConfig>): ExtensionConfig {
  const merged = {
    ...DEFAULT_CONFIG,
    ...(overrides ?? {})
  };

  return {
    ...merged,
    windowSizeQa: clampInteger(merged.windowSizeQa, 1),
    loadBatchQa: clampInteger(merged.loadBatchQa, 1),
    topThresholdPx: clampInteger(merged.topThresholdPx, 0),
    preloadBufferPx: clampInteger(merged.preloadBufferPx, 0),
    searchContextBefore: clampInteger(merged.searchContextBefore, 0),
    searchContextAfter: clampInteger(merged.searchContextAfter, 0),
    maxPersistedSessions: clampInteger(merged.maxPersistedSessions, 1),
    stabilityQuietMs: clampInteger(merged.stabilityQuietMs, 0)
  };
}

function clampInteger(value: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.max(minimum, Math.trunc(value));
}
