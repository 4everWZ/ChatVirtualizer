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
- Turn busy signals are classified before record assembly, but only the tail reply cluster may keep `generating=true`. Historical assistant turns that momentarily expose `aria-busy` or writing markers during hydration must be normalized back to non-generating records.
- Default active window range is the last `windowSizeQa` non-protected records. Generating or TTL-protected records stay mounted without consuming that 10-record tail budget.
- Visible records have three render modes:
  - `live`: full original ChatGPT DOM kept in the main reading flow.
  - `lite`: a visible lightweight reading-state wrapper built from sanitized snapshot HTML.
  - `collapsed`: not mounted in the main reading flow and represented only by the compact collapsed group plus native-find reservoirs.
- In the steady-state default window, the newest four non-protected visible records remain `live`, while the older visible portion of the 10-record window is downgraded to `lite`.
- During bootstrapping, the system must pressure-relieve old history as soon as provisional QA records exceed `windowSizeQa` instead of waiting for the full steady-state quiet period.
- Top restore shifts the mounted range backward by `loadBatchQa` and flips the session controller into `manual-expanded` mode.
- While `manual-expanded` is active, same-session tail growth appends new records without re-collapsing the manually restored history. Returning to the bottom zone re-applies the normal tail window.
- Contiguous unmounted records are rendered as a single compact collapsed group with one visible summary row and one `hidden="until-found"` reservoir per record.
- `lite` records are promoted back to `live` on direct interaction triggers such as `click`, `focusin`, `pointerenter`, selection start, quick-jump restore, or native `beforematch`.
- When the preferred live subset would exceed the four-record hot budget, the oldest unprotected live record is demoted back to `lite`; forced live contexts such as quick-jump targets and native-find restore ranges may temporarily exceed that budget.
- Scroll compensation is the measured delta between the pre-restore and post-restore scroll height applied back onto `scrollTop`.
- Initial collapse must not force synchronous layout reads or eager HTML snapshot serialization on the hot path. Height stays on the record engine's estimated value during attach, collapse, and same-session restore.
- Evicted records keep detached DOM roots only for a short same-session retention window. Snapshot serialization is deferred off the collapse hot path, and once a lightweight snapshot is ready and the retention TTL expires, the detached DOM is released.
- Snapshot restore uses sanitized lightweight HTML that preserves reading content while stripping heavy interaction chrome such as old turn action buttons and citation pills.
- Same-session reindex must merge the current visible DOM tail back into the in-memory record set instead of throwing away collapsed history on every mutation.
- Same-session reindex must align the adapter-visible DOM tail against the existing record suffix instead of assuming every mounted visible record is still backed by live ChatGPT turn DOM.
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
- Short-lived detached roots keep immediate same-session restores fast, but after the TTL expires the system restores from lighter snapshot HTML rather than the original DOM tree.
- Keeping generating or protected records outside the nominal 10-record tail means mounted count can temporarily exceed `windowSizeQa`, but it avoids collapsing active or user-focused content.
- Tail-only generation normalization is intentionally opinionated for ChatGPT: it rejects mid-thread hydrate noise in exchange for keeping the mounted window predictable on long real-world threads.

## Verification

- Unit tests must cover grouping rules, record-state transitions, window calculations, and collapsed-group metadata.
- DOM integration tests must confirm initial compression, grouped folds, top restore, scroll compensation, generating protection, same-session auto-compress after tail growth, manual-expanded preservation, and no-op degradation when restore cannot complete safely.
- DOM integration tests must confirm that historical hydrate-busy assistant turns still collapse into the normal tail window and that descendant busy-node settlement re-applies the 10-record auto window without refresh.
- Virtualization tests must assert that initial attach and collapse do not call `getBoundingClientRect()` and do not synchronously read evicted record `innerHTML`.
- Virtualization tests must assert that detached roots are released after the retention TTL once snapshots are ready, and that snapshot restore omits heavy action chrome while keeping readable message content.
- Virtualization tests must assert that the default visible window splits into four `live` records plus older `lite` records, and that interacting with a `lite` record promotes it while demoting the oldest unprotected `live` record.
