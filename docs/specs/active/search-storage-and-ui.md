# Search, Storage, And UI Spec

## Goals & Boundaries

- Search only the current session using local cached record text.
- Restore a hit plus configurable context and scroll to the hit.
- Persist config in `chrome.storage.local` and snapshots in IndexedDB.
- Expose runtime status and controls through popup and options surfaces.
- Keep all user content local; no telemetry or remote upload in the current version.

Cross-session search is not implemented in the current version.

## Math / Logic

- Search scoring combines exact substring matches with token-overlap matches across user text, assistant text, code text, and combined text.
- Search-hit restoration expands by `searchContextBefore` and `searchContextAfter`, then grants the local range a short eviction-protection TTL.
- Snapshot persistence uses per-session buckets with LRU eviction across sessions capped by `maxPersistedSessions`.
- Popup stats are derived from content-script state pushed to the background service worker on each reindex or virtualization event.

## Code Mapping

- `src/content/search/search-engine.ts`
- `src/content/search/search-overlay.ts`
- `src/shared/storage/config-store.ts`
- `src/shared/storage/snapshot-store.ts`
- `src/background/service-worker.ts`
- `src/popup/main.ts`
- `src/options/main.ts`

## Tradeoffs

- The search UI is injected into the page via ShadowRoot so jump-to-result interactions can stay local to the active tab without fighting site CSS.
- `chrome.storage.local` is limited to small settings and diagnostics to avoid snapshot-size pressure.
- IndexedDB is used only for stable snapshots and search text; unstable or broken records are excluded from persistence.

## Verification

- Unit tests must cover search ranking, config persistence, message contracts, and session LRU eviction.
- Playwright tests must verify popup-triggered search toggle, search-hit restoration, and options persistence.
