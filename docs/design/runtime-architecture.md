# Runtime Architecture

## Runtime Flow

1. `bootstrap.ts` checks the current page and loads the ChatGPT adapter.
2. The session controller resolves `sessionId`, the scroll container, and turn candidates.
3. The record engine groups the DOM into ordered QA records and extracts search text.
4. The virtualization engine snapshots eligible historical records and replaces them with placeholders.
5. The scroll manager listens for top-trigger restore conditions and applies anchor compensation.
6. The search overlay queries local session text, restores the selected range, and scrolls to the hit.
7. The background worker stores the latest per-tab status for popup and options pages.

## Main Boundaries

- Adapter boundary: site-specific detection and DOM collection.
- Record boundary: stable logical representation of DOM turns.
- Virtualization boundary: placeholder and restore operations only mutate record-owned roots.
- Storage boundary: config and snapshots remain local to the browser.
- UI boundary: popup/options are passive controls; the search overlay is page-local.

## Safety Properties

- Unknown layouts degrade to no-op.
- Stable records are the only records eligible for persistence or virtualization.
- Generating or protected records remain mounted.
- Session switches cancel pending restore and serialization tasks.
