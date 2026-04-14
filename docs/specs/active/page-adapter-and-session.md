# Page Adapter And Session Spec

## Goals & Boundaries

- Detect whether the current page is a supported ChatGPT chat surface.
- Derive a stable `sessionId` per conversation view.
- Locate the scroll container and candidate turn roots using semantic and attribute-driven heuristics.
- Observe URL or DOM-driven session changes and rebuild state on change.
- Expose optional hooks for site-owned quick-jump surfaces when ChatGPT renders them.
- Fail closed when page confidence drops below the supported threshold.

Only ChatGPT is implemented in the current version.

## Math / Logic

- Adapter confidence is derived from the presence of a scroll container, multiple turn nodes, and user/assistant role signals.
- Session identity prefers URL path segments shaped like `/c/<id>`, then falls back to pathname plus title hash for unsupported layouts.
- The content bootstrap must stay armed on DOM-driven triggers until the supported thread contract appears; an early `document_idle` pass is not sufficient on live ChatGPT because turns can render after the content script starts.
- The first supported-thread bootstrap must use a short activation quiet window so initial compression begins soon after the thread contract appears; the longer `stabilityQuietMs` debounce is reserved for later same-session reindex work.
- Session change detection must be event-driven through DOM mutation and History API hooks; timer polling, dead loops, busy waits, and CPU spin are forbidden.
- Reindexing is debounced so repeated mutations collapse into a single rebuild window.
- Same-session tail growth must be handled incrementally when the visible mounted records remain compatible with the previous session state; full rebuild is the fallback, not the default path.
- Any pending restore work is cancelled when the session token changes.
- Native ChatGPT edit mode is a temporary unsupported transition. Once an `Edit message` trigger is detected, the session controller must suspend virtualization, unwrap extension-owned live wrappers, remove collapsed groups, and wait until the supported turn contract returns before rebuilding.
- Session state has two runtime modes:
  - `auto`: keep the most recent `windowSizeQa` stable records mounted, while generating and temporarily protected records may extend the mounted set until they settle.
  - `manual-expanded`: entered after top-triggered restore or site quick-jump expansion; new tail records append without immediately re-collapsing old history.
- Session bootstrap also carries an internal phase:
  - `bootstrapping`: the thread is still settling, so same-session reindex work must use a short quiet window and pressure-relieve old history as soon as provisional QA records exceed `windowSizeQa`.
  - `steady`: entered only after a full `stabilityQuietMs` quiet period with no relevant turn settlement; later same-session reindex work returns to the normal steady debounce.
- Returning to the bottom zone, defined as `scrollHeight - clientHeight - scrollTop <= preloadBufferPx`, restores `auto` mode.
- Live ChatGPT validation on April 5, 2026 confirmed the current thread container contract:
  - scroll root: `div[data-scroll-root]` wrapping `main#main`
  - turn root: `section[data-testid^="conversation-turn-"][data-turn][data-turn-id]`
  - role signal: `data-turn="user" | "assistant"`
  - accessibility label fallback: `h4.sr-only` with `You said:` or `ChatGPT said:`
- Live ChatGPT validation on April 12, 2026 showed that historical assistant turns can briefly expose `aria-busy` during hydration. Those non-tail busy signals must not be treated as long-lived generation protection.
- When present, the site quick-jump rail is discovered through `.fixed.end-4.top-1\/2.z-20.-translate-y-1\/2`, and click handling is delegated at the container boundary so the extension does not bind per-item listeners.
- When live `section[data-testid^="conversation-turn-"][data-turn]` roots are present, the adapter must ignore nested `[data-message-author-role]` descendants. Real ChatGPT duplicates user and assistant content inside those descendants, and treating both layers as turn roots doubles record counts and destabilizes virtualization.
- `nav[aria-label="Chat history"]` is the left sidebar history list, not the conversation scroll root, and must not be used for virtualization.

## Code Mapping

- `src/content/adapters/chatgpt/chatgpt-adapter.ts`
- `src/content/session-controller.ts`
- `src/shared/contracts.ts`

## Tradeoffs

- The adapter intentionally prefers robust `aria-*`, `data-*`, and textual heuristics over brittle class selectors.
- Confidence-based no-op behavior is safer than forcing virtualization on unknown layouts.
- Session resets discard in-flight work to avoid cross-thread corruption.
- Live DOM contracts are anchored on semantic `data-*` attributes first and use the accessibility heading labels only as fallback, because class names remain highly volatile.
- Site quick-jump integration stays optional and adapter-owned. If the rail selector disappears, core virtualization still works and the quick-jump path degrades to native site behavior.

## Verification

- Fixture-based tests must cover supported chat layouts, malformed layouts, and session-change rebuilds.
- Adapter tests must assert that session-change observation does not use `setInterval` polling.
- Adapter tests must assert that live outer turn sections win over nested author-role descendants when both exist in the DOM.
- Session-controller tests must assert that historical hydrate-busy assistant turns do not prevent the auto window from collapsing to the latest 10 QA records.
- Session-controller tests must cover same-session incremental growth beyond the 10-record window without a page refresh.
- Session-controller tests must cover bootstrapping threads that start below the QA window and later grow past it without waiting for the full steady-state debounce.
- Session-controller tests must cover bottom-zone recovery from `manual-expanded` back to `auto`.
- Session-controller tests must cover descendant busy-node settlement inside an existing turn and confirm re-compression occurs without refresh.
- Session-controller tests must cover native `Edit message` transitions and confirm virtualization suspends during edit mode, then rebuilds the normal window after edit mode exits.
- Adapter tests must cover optional quick-jump container discovery and text extraction.
- Live smoke verification must confirm URL-based session detection on a real ChatGPT conversation.
- Supported fixtures must include a sidebar `nav[aria-label="Chat history"]` alongside a real thread `div[data-scroll-root]` so false-positive container selection is caught in CI.
