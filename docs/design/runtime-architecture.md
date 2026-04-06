# Runtime Architecture

## Runtime Flow

1. `bootstrap.ts` checks the current page and loads the ChatGPT adapter.
2. The session controller resolves `sessionId`, the scroll container, and turn candidates.
3. The record engine groups the DOM into ordered QA records and extracts normalized record text.
4. The session controller maintains a two-mode window state machine: `auto` for the normal bounded tail window and `manual-expanded` after user-driven history expansion.
5. The virtualization engine snapshots eligible historical records, keeps detached DOM only for a short same-session retention window, and replaces old history with compact collapsed groups.
6. The scroll manager listens for top-trigger restore conditions and applies anchor compensation.
7. Site-owned quick-jump rails can delegate clicks back into the session controller so collapsed targets restore before scrolling.
8. Native browser find targets `hidden="until-found"` reservoirs inside collapsed groups, and `beforematch` restores the matched range.
9. The popup queries the active content tab for stats and falls back to background-cached state when necessary.

## Main Boundaries

- Adapter boundary: site-specific detection and DOM collection.
- Record boundary: stable logical representation of DOM turns.
- Virtualization boundary: collapsed-group and restore operations only mutate record-owned roots.
- Window-state boundary: only the session controller decides when the system is in `auto` vs `manual-expanded`.
- Storage boundary: config and snapshots remain local to the browser.
- UI boundary: popup/options are passive controls; browser-native find remains the only search entry point.

## Safety Properties

- Unknown layouts degrade to no-op.
- Stable records are the only records eligible for persistence or virtualization.
- Generating or protected records remain mounted.
- Bottom-zone return switches the system back to `auto` without polling.
- Session switches cancel pending restore and serialization tasks.
- Detached roots are released after a short TTL once lightweight snapshots are available, so collapsed history does not keep the full original DOM tree indefinitely.
