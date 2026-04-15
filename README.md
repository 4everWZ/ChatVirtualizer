# Edge Chat Virtualizer

`Edge Chat Virtualizer` is a Microsoft Edge Manifest V3 extension that reduces ChatGPT long-thread DOM pressure by virtualizing older QA records, restoring them on demand, and keeping collapsed history discoverable through native browser find.

## Current Scope

- Target site: ChatGPT Web
- Runtime model: content-script-first Edge MV3 extension
- Storage: `chrome.storage.local` for config, IndexedDB for record snapshots
- Status: v1 local implementation with fixture-based browser verification

## Implemented Behaviors

- Detect supported ChatGPT chat pages and derive a per-session ID
- Group DOM turns into logical QA records
- Keep the latest QA window mounted and collapse older records into compact grouped folds
- Split the mounted QA window into a lightweight reading subset plus a small hot live subset, so the newest four records keep full ChatGPT DOM while older visible records are downgraded to lighter reading-state wrappers
- Auto-compress the same conversation back to the latest 10 stable QA records as new turns arrive, without requiring a page refresh
- Ignore transient mid-thread hydration busy markers so historical assistant messages do not get pinned in the mounted window
- Recover when ChatGPT replaces the active thread or scroll container, instead of leaving a blank page with stale mounted-state bookkeeping
- Preserve manually restored older history until the user returns near the bottom of the conversation
- Restore older history when the user reaches the top of the chat container
- Expand collapsed history when ChatGPT's site-owned quick-jump rail targets an older collapsed record
- Suspend virtualization during ChatGPT's native `Edit message` flow immediately, including before the first compression pass has attached, then rebuild the normal window only after the post-edit thread has settled and the recovered DOM is either merge-safe against the pre-edit record set or close to a full-thread rebuild
- Refuse unsafe window swaps that would otherwise evict the whole visible thread before replacement records are actually restorable
- Support native browser find on collapsed history via `hidden="until-found"` reservoirs and `beforematch` restore
- Keep collapsed DOM roots only briefly for same-session fast restore, then fall back to lightweight snapshots for lower memory retention
- Expose popup stats and options for runtime configuration
- Report prompt session fallback stats during thread navigation so the popup does not keep showing the previous conversation while the next one is still loading
- Degrade safely when the page structure is unsupported
- Stay event-driven end to end; no timer polling, busy waits, or CPU spin loops are allowed in runtime behavior
- Use a short first-pass activation quiet window for live ChatGPT bootstrap, while keeping `stabilityQuietMs` for steady-state reindex debounce
- Keep an internal `bootstrapping -> steady` phase so long threads can pressure-relieve early without introducing polling

## Default Configuration

```ts
const DEFAULT_CONFIG = {
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
  stabilityQuietMs: 1500,
};
```

## Options Reference

- `Window size`
  Number of QA records the extension tries to keep visible in the normal auto window. With the default `10`, older records are collapsed once the thread grows past 10 stable QA pairs.
- `Load batch`
  How many older QA records to restore each time you hit the top-restore path. Higher values pull history back faster, but they also grow the mounted DOM faster.
- `Top threshold px`
  How close the chat scroller must be to the very top before the extension treats it as an intentional “load older history” action. This is now a hard gate for both the scroll listener and the top sentinel observer; intersecting the sentinel alone is no longer enough to restore history early.
- `Preload buffer px`
  Bottom-zone threshold used to switch back from manual-expanded mode to auto mode. When you scroll back within this many pixels of the bottom, the extension is allowed to recompress older history again.
- `Context before`
  When native browser find or site quick-jump restores a collapsed target, this many QA records before the target are also restored for context.
- `Context after`
  Same as `Context before`, but for records after the target.
- `Max cached sessions`
  Maximum number of sessions whose IndexedDB snapshots are retained locally. Older session caches are pruned with an LRU policy.
- `Stability quiet ms`
  Debounce window used before steady-state reindex or recovery work runs. Larger values wait longer for ChatGPT DOM churn to settle; smaller values react faster but increase the chance of acting during host-side rebuilds.
- `Protect generating records`
  Keeps actively generating assistant records mounted even if that temporarily pushes the mounted count above `Window size`.
- `Enable virtualization`
  Master switch for collapsing old history. When disabled, the extension still detects the session, but it stops collapsing and restoring records.
- `Enable debug logging`
  Turns on verbose `[ECV]` console logs for live debugging. Leave it off in normal use because it is only for diagnosis.

## Tuning Guidance

- If you want lower memory and less visible DOM, reduce `Window size`.
- If top-scroll restore feels too slow, increase `Load batch`.
- If auto recompression happens too eagerly after you inspect old history, increase `Preload buffer px`.
- If ChatGPT is still rebuilding when the extension reacts, increase `Stability quiet ms`.
- If you want more context around native-find hits or quick-jump targets, raise `Context before` and `Context after`.

## Runtime Resource Discipline

- Runtime behavior is event-driven. The extension uses DOM events, `MutationObserver`, `IntersectionObserver`, and bounded one-shot timers for debounce or delayed cleanup.
- Polling loops are intentionally disallowed. There is no runtime `setInterval` polling and no `requestAnimationFrame` spin loop in `src/`.
- Detached DOM kept for fast same-session restore is released on a bounded timer and falls back to lightweight snapshots, so old full DOM trees are not retained indefinitely.
- If a future change needs to add recurring work, it should be treated as a design problem first, not as an implementation convenience.

## Getting Started

### Requirements

- Node.js 22+
- `pnpm` 10+
- Microsoft Edge or Chromium-based browser with Developer Mode enabled

### Install Dependencies

```bash
pnpm install
```

### Build The Extension

```bash
pnpm build
```

The loadable extension output is generated in `dist/`.

### Load In Edge

1. Open `edge://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the folder:

```text
<repo>/dist
```

Do not load the repository root. Edge needs the built `dist/manifest.json`, not the source `manifest.config.ts`.

## Development Commands

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:playwright
pnpm verify
```

### Optional Live Smoke Test

The real ChatGPT smoke test is opt-in and requires a signed-in Chromium profile.

```bash
set LIVE_CHATGPT=1
set ECV_LIVE_CHAT_URL=https://chatgpt.com/c/<session-id>
set ECV_LIVE_USER_DATA_DIR=<path-to-your-browser-profile>
pnpm test:live
```

## Repository Layout

```text
docs/
  specs/active/                 Current source of truth
  specs/legacy/                 Original monolithic spec
  design/                       Architecture notes
src/
  background/                   MV3 service worker
  content/                      Adapter, session, virtualization, native-find, scroll logic
  options/                      Options page
  popup/                        Popup UI
  shared/                       Typed contracts, config, storage, messaging
tests/
  unit/                         Pure logic tests
  integration/                  DOM fixture integration tests
  playwright/                   Browser-level extension tests
  fixtures/                     Local chat fixtures and fixture server
```

## Documentation Map

Primary implementation docs live under `docs/specs/active/`:

- `overview.md`
- `page-adapter-and-session.md`
- `record-engine-and-virtualization.md`
- `search-storage-and-ui.md`
- `integration-and-verification.md`

Supporting docs:

- `docs/design/runtime-architecture.md`
- `docs/implementation_objections_and_tradeoffs.md`

## Verification Status

The current repository is wired to verify through:

- `pnpm verify`
- `pnpm test:playwright`

`pnpm test:playwright` uses local HTML fixtures plus a built extension. The live ChatGPT smoke test remains optional.

## Known Boundaries

- ChatGPT Web only in the current version
- Native browser find support is current-session only
- Snapshot restore targets reading fidelity, not full site-internal component behavior parity
- Released collapsed history restores as lightweight reading-state DOM, so old turn toolbars and similar interaction chrome are intentionally not preserved
- Older visible records inside the mounted window also use lightweight reading-state DOM, so only the hottest subset keeps full ChatGPT turn chrome by default
- Native `Edit message` temporarily drops extension-owned collapsed groups and wrappers so ChatGPT can own the edit DOM; after edit exit, the controller stays suspended until the returning thread DOM is safe to merge or close to fully rebuilt, rather than trusting an obviously partial subtree, and it re-suspends if ChatGPT clears that recovered DOM again during the same transition
- The fixture browser suite verifies popup stats and native-find restore behavior; real signed-in ChatGPT validation is still an explicit optional step
