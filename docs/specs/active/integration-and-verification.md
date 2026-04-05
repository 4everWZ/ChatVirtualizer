# Integration And Verification Spec

## Summary

The system is assembled around a session controller that coordinates adapter discovery, record indexing, virtualization, search, storage, and runtime messaging. Every boundary that can fail must degrade to a safe no-op or placeholder-preserving state.

## Integration Rules

- Content bootstrap owns initialization and exits quietly when the adapter cannot confidently support the page.
- If the adapter is not yet confident because live ChatGPT has not rendered turns, the content bootstrap must stay armed with a DOM-triggered activation watcher and retry instead of permanently exiting.
- Session rebuilds are atomic from the content script’s perspective: cancel pending work, rebuild records, re-evaluate the mounted window, then publish stats.
- Background, popup, and options communicate only through typed runtime messages.
- Storage access is asynchronous and must never block DOM mutation handling on the hot path.

## Verification Plan

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:playwright`
- Optional live smoke: `pnpm test:live` with a signed-in browser profile.
- When real ChatGPT DOM contracts change, update the fixture pages to mirror the validated shape before treating the adapter as current.

## Acceptance Mapping

- FR-01 and FR-02 map to adapter and record-engine tests.
- FR-03, FR-04, and FR-06 map to virtualization and Playwright restore tests.
- FR-05 and FR-07 map to search and snapshot-store tests.
- FR-08 maps to the live smoke and fixture-based Playwright harness.
- Sidebar false-positive protection maps to the adapter fixture that combines `nav[aria-label="Chat history"]` with the real `div[data-scroll-root]` thread layout.

## Failure Boundaries

- Unknown page structure: no virtualization, no DOM mutation beyond the injected shell.
- Snapshot restore failure: leave the placeholder in place and mark the record bad.
- Session switch during restore: cancel work and restart against the new session.
- Duplicate site re-render: dedupe by record signature before recomputing ranges.
