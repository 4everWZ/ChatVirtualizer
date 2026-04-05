# Runtime Architecture

## Runtime Flow

1. `bootstrap.ts` checks the current page and loads the ChatGPT adapter.
2. The session controller resolves `sessionId`, the scroll container, and turn candidates.
3. The record engine groups the DOM into ordered QA records and extracts normalized record text.
4. The virtualization engine snapshots eligible historical records and replaces them with compact collapsed groups.
5. The scroll manager listens for top-trigger restore conditions and applies anchor compensation.
6. Native browser find targets `hidden="until-found"` reservoirs inside collapsed groups, and `beforematch` restores the matched range.
7. The popup queries the active content tab for stats and falls back to background-cached state when necessary.

## Main Boundaries

- Adapter boundary: site-specific detection and DOM collection.
- Record boundary: stable logical representation of DOM turns.
- Virtualization boundary: collapsed-group and restore operations only mutate record-owned roots.
- Storage boundary: config and snapshots remain local to the browser.
- UI boundary: popup/options are passive controls; browser-native find remains the only search entry point.

## Safety Properties

- Unknown layouts degrade to no-op.
- Stable records are the only records eligible for persistence or virtualization.
- Generating or protected records remain mounted.
- Session switches cancel pending restore and serialization tasks.
