# Record Engine And Virtualization Spec

## Goals & Boundaries

- Group DOM turns into logical QA records.
- Keep the most recent `windowSizeQa` records mounted by default.
- Serialize older stable records into snapshots, replace them with equal-height placeholders, and restore them by range.
- Protect generating, selected, hovered, and search-focused records from eviction.
- Preserve viewport position during top-triggered restore.

The current version targets reading fidelity after restore rather than full React-internal behavioral parity.

## Math / Logic

- A QA record is built from one or more user turns followed by assistant-owned content until the next user turn starts.
- A record becomes eligible for virtualization only when it is stable, not generating, and not under temporary protection.
- Default active window range is the last `windowSizeQa` records. Top restore shifts the mounted range backward by `loadBatchQa`.
- Scroll compensation is the measured delta between the pre-restore and post-restore top anchor positions.
- Placeholder height is seeded from measured DOM height and updated after restore if the actual height changes.

## Code Mapping

- `src/content/records/record-engine.ts`
- `src/content/virtualization/virtualization-engine.ts`
- `src/content/virtualization/placeholders.ts`
- `src/content/scroll/scroll-manager.ts`
- `src/shared/contracts.ts`

## Tradeoffs

- Snapshot serialization stores sanitized HTML plus normalized text because full component-state replay is out of scope.
- Range-based restore keeps the implementation predictable and easier to verify than fine-grained node streaming.
- Re-compressing far-away restored records limits DOM growth without requiring complex predictive scheduling.

## Verification

- Unit tests must cover grouping rules, record-state transitions, window calculations, and placeholder metadata.
- DOM integration tests must confirm initial compression, top restore, scroll compensation, generating protection, and no-op degradation when restore cannot complete safely.
