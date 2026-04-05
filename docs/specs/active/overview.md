# Edge Chat Virtualizer Active Specification

## Summary

This active spec defines the v1 implementation of the Edge Chat Virtualizer as a ChatGPT-only Edge MV3 extension. The implementation goal is to reduce long-thread DOM pressure by keeping only a bounded recent QA window mounted, restoring older history on demand, and searching locally across cached records.

## Scope

- Target site: ChatGPT Web.
- Runtime shape: content-script-first Edge MV3 extension.
- Core behaviors: session detection, QA record grouping, virtualization, top-triggered restore, local search, popup/options configuration, and safe degradation.
- Persistence: local-only configuration in `chrome.storage.local`, record snapshots and search text in IndexedDB.

## Document Set

- `page-adapter-and-session.md`
- `record-engine-and-virtualization.md`
- `search-storage-and-ui.md`
- `integration-and-verification.md`

## Defaults

```ts
const DEFAULT_CONFIG = {
  windowSizeQa: 10,
  loadBatchQa: 5,
  topThresholdPx: 24,
  preloadBufferPx: 2000,
  searchContextBefore: 1,
  searchContextAfter: 1,
  protectGenerating: true,
  enableSearch: true,
  enableVirtualization: true,
  debugLogging: false,
  maxPersistedSessions: 5,
  stabilityQuietMs: 1500,
};
```

## Traceability

- Session and page-structure rules live in `page-adapter-and-session.md`.
- Record grouping, placeholder handling, restore, and scroll compensation live in `record-engine-and-virtualization.md`.
- Search, persistence, popup/options, and debug surfaces live in `search-storage-and-ui.md`.
- Cross-module assembly and required verification paths live in `integration-and-verification.md`.
