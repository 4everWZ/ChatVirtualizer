# Page Adapter And Session Spec

## Goals & Boundaries

- Detect whether the current page is a supported ChatGPT chat surface.
- Derive a stable `sessionId` per conversation view.
- Locate the scroll container and candidate turn roots using semantic and attribute-driven heuristics.
- Observe URL or DOM-driven session changes and rebuild state on change.
- Fail closed when page confidence drops below the supported threshold.

Only ChatGPT is implemented in the current version.

## Math / Logic

- Adapter confidence is derived from the presence of a scroll container, multiple turn nodes, and user/assistant role signals.
- Session identity prefers URL path segments shaped like `/c/<id>`, then falls back to pathname plus title hash for unsupported layouts.
- The content bootstrap must stay armed on DOM-driven triggers until the supported thread contract appears; an early `document_idle` pass is not sufficient on live ChatGPT because turns can render after the content script starts.
- Reindexing is debounced so repeated mutations collapse into a single rebuild window.
- Any pending restore work is cancelled when the session token changes.
- Live ChatGPT validation on April 5, 2026 confirmed the current thread container contract:
  - scroll root: `div[data-scroll-root]` wrapping `main#main`
  - turn root: `section[data-testid^="conversation-turn-"][data-turn][data-turn-id]`
  - role signal: `data-turn="user" | "assistant"`
  - accessibility label fallback: `h4.sr-only` with `You said:` or `ChatGPT said:`
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

## Verification

- Fixture-based tests must cover supported chat layouts, malformed layouts, and session-change rebuilds.
- Live smoke verification must confirm URL-based session detection on a real ChatGPT conversation.
- Supported fixtures must include a sidebar `nav[aria-label="Chat history"]` alongside a real thread `div[data-scroll-root]` so false-positive container selection is caught in CI.
