# Record Engine And Virtualization Spec

## Goals & Boundaries

- Group DOM turns into logical QA records.
- Keep the most recent `windowSizeQa` records mounted by default.
- Serialize older stable records into snapshots, collapse contiguous historical ranges into compact groups, and restore them by range.
- Protect generating, selected, hovered, and search-focused records from eviction.
- Preserve viewport position during top-triggered restore.

The current version targets reading fidelity after restore rather than full React-internal behavioral parity.

## Math / Logic

- A QA record is built from one or more user turns followed by assistant-owned content until the next user turn starts.
- A record becomes eligible for virtualization only when it is stable, not generating, and not under temporary protection.
- Default active window range is the last `windowSizeQa` non-protected records. Generating or TTL-protected records stay mounted without consuming that 10-record tail budget.
- Top restore shifts the mounted range backward by `loadBatchQa` and flips the session controller into `manual-expanded` mode.
- While `manual-expanded` is active, same-session tail growth appends new records without re-collapsing the manually restored history. Returning to the bottom zone re-applies the normal tail window.
- Contiguous unmounted records are rendered as a single compact collapsed group with one visible summary row and one `hidden="until-found"` reservoir per record.
- Scroll compensation is the measured delta between the pre-restore and post-restore scroll height applied back onto `scrollTop`.
- Initial collapse must not force synchronous layout reads or eager HTML snapshot serialization on the hot path. Height stays on the record engine's estimated value during attach, collapse, and same-session restore.
- Same-session restore prefers detached DOM roots captured at eviction time. Sanitized HTML snapshots are persisted only as a best-effort stop-time path, not as part of the initial live-page collapse.
- Same-session reindex must merge the current visible DOM tail back into the in-memory record set instead of throwing away collapsed history on every mutation.
- Site quick-jump expansion reuses the same range-restore path as top-triggered restore and restores `target +/- searchContextBefore/searchContextAfter`.

## Code Mapping

- `src/content/records/record-engine.ts`
- `src/content/virtualization/virtualization-engine.ts`
- `src/content/virtualization/placeholders.ts`
- `src/content/scroll/scroll-manager.ts`
- `src/shared/contracts.ts`

## Tradeoffs

- Snapshot serialization stores sanitized HTML plus normalized text because full component-state replay is out of scope, but that serialization is intentionally kept off the initial collapse hot path.
- Range-based restore keeps the implementation predictable and easier to verify than fine-grained node streaming.
- Compact grouped folds materially reduce scroll height, but they give up the exact scroll geometry that equal-height placeholders would preserve.
- Re-compressing far-away restored records limits DOM growth without requiring complex predictive scheduling.
- Detached in-memory roots increase same-session memory use, but they remove the real-world startup penalty that eager snapshot generation caused on large live ChatGPT threads.
- Keeping generating or protected records outside the nominal 10-record tail means mounted count can temporarily exceed `windowSizeQa`, but it avoids collapsing active or user-focused content.

## Verification

- Unit tests must cover grouping rules, record-state transitions, window calculations, and collapsed-group metadata.
- DOM integration tests must confirm initial compression, grouped folds, top restore, scroll compensation, generating protection, same-session auto-compress after tail growth, manual-expanded preservation, and no-op degradation when restore cannot complete safely.
- Virtualization tests must assert that initial attach and collapse do not call `getBoundingClientRect()` and do not synchronously read evicted record `innerHTML`.
