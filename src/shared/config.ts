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
  return {
    ...DEFAULT_CONFIG,
    ...(overrides ?? {})
  };
}
