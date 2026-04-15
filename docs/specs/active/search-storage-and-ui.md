# Search, Storage, And UI Spec

## Goals & Boundaries

- Make collapsed current-session history discoverable through browser-native find.
- Restore a matched record plus configurable context when native find lands in collapsed history.
- Persist config in `chrome.storage.local` and snapshots in IndexedDB.
- Expose runtime status and controls through popup and options surfaces without a custom search UI.
- Keep all user content local; no telemetry or remote upload in the current version.

Cross-session search is not implemented in the current version.

## Math / Logic

- Each collapsed record contributes a normalized text reservoir kept in the DOM with `hidden="until-found"`.
- Native `beforematch` on a reservoir restores the matched record plus `searchContextBefore` and `searchContextAfter`.
- If restore cannot remount the record during `beforematch`, the reservoir is revealed in plain text so browser-native find still lands on a valid node.
- Snapshot persistence uses per-session buckets with LRU eviction across sessions capped by `maxPersistedSessions`.
- Same-session collapsed history may keep detached DOM briefly for fast local restore, but IndexedDB-backed snapshots are prepared as lightweight reading-state HTML so released records do not require the original DOM tree to come back.
- The same lightweight reading-state HTML is also reused for visible `lite` records inside the mounted window so the older visible portion of the 10-record tail no longer carries full ChatGPT turn chrome.
- Popup config is read directly from `chrome.storage.local` so the popup still renders even if the MV3 background worker is temporarily unavailable.
- Popup stats query the active content tab directly on open and fall back to background-cached stats only when the content script is not reachable.

## Options Semantics

- `windowSizeQa`
  Target number of QA records kept visible in normal auto mode. Older stable records beyond that tail are eligible for collapse.
- `loadBatchQa`
  Number of older QA records restored per top-triggered history expansion.
- `topThresholdPx`
  Scroll-top tolerance for triggering older-history restore. The restore path activates only when the chat scroller is within this many pixels of the top, even if the top sentinel observer intersects earlier.
- `preloadBufferPx`
  Bottom-zone tolerance for returning from `manual-expanded` back to `auto`. Once the user scrolls back within this distance of the bottom, auto compression may resume.
- `searchContextBefore` / `searchContextAfter`
  Context radius restored around a native-find hit or site quick-jump target.
- `maxPersistedSessions`
  LRU retention cap for per-session IndexedDB snapshot buckets.
- `stabilityQuietMs`
  Steady-state debounce window before reindex or recovery work runs after relevant host mutations. It does not replace the short bootstrap quiet window used for first pressure relief.
- `protectGenerating`
  Prevents actively generating records from being collapsed mid-generation, even when that temporarily exceeds the nominal window size.
- `enableVirtualization`
  Master runtime gate for collapse/restore behavior.
- `debugLogging`
  Enables verbose `[ECV]` console diagnostics only; it has no product-facing effect beyond logging.

## Code Mapping

- `src/content/session-controller.ts`
- `src/content/virtualization/virtualization-engine.ts`
- `src/content/virtualization/placeholders.ts`
- `src/shared/storage/config-store.ts`
- `src/shared/storage/snapshot-store.ts`
- `src/background/service-worker.ts`
- `src/popup/main.ts`
- `src/options/main.ts`

## Tradeoffs

- Native browser find avoids custom page UI and shortcut interception, but it depends on modern `beforematch` behavior.
- `chrome.storage.local` is limited to small settings and diagnostics to avoid snapshot-size pressure.
- IndexedDB is used only for stable snapshots and normalized record text; unstable or broken records are excluded from persistence.
- Lightweight snapshots trade away old-message interactivity in favor of lower restore weight and lower same-session memory retention.
- Visible `lite` records trade away always-on turn chrome in exchange for lower mounted DOM weight; direct interaction promotes them back toward the live subset.
- Runtime scheduling stays event-driven by design. Debounce timers are bounded one-shot timers; polling loops, busy waits, and unbounded retained detached DOM are explicitly out of bounds.

## Verification

- Unit tests must cover config persistence, runtime message contracts, and session LRU eviction.
- Integration tests must verify `beforematch` restoration with configured context and plain-text fallback on restore failure.
- Integration tests must verify released detached roots can still restore from lightweight snapshots.
- Playwright tests must verify popup stats without custom search controls, blank-chat status, and collapsed-history behavior.
