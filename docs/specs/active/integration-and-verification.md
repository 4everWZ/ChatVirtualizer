# Integration And Verification Spec

## Summary

The system is assembled around a session controller that coordinates adapter discovery, record indexing, virtualization, native-find restoration, storage, and runtime messaging. Every boundary that can fail must degrade to a safe no-op or collapsed-group-preserving state.

## Integration Rules

- Content bootstrap owns initialization and exits quietly when the adapter cannot confidently support the page.
- If the adapter is not yet confident because live ChatGPT has not rendered turns, the content bootstrap must stay armed with a DOM-triggered activation watcher and retry instead of permanently exiting.
- Runtime control flow must stay event-driven end to end. Timer polling, dead loops, busy waits, and long-running CPU spin used only to simplify implementation are forbidden.
- Session rebuilds are atomic from the content script’s perspective: cancel pending work, rebuild records, re-evaluate the mounted window, then publish stats.
- Same-session tail growth must prefer incremental reconcile over full session rebuild when the mounted visible tail is still structurally compatible.
- Initial history collapse must not synchronously wait for slow IndexedDB persistence before removing eligible old records from the live DOM.
- Initial history collapse must not force synchronous layout reads or eager HTML snapshot generation on the live-page hot path.
- Mutation handling must remain event-driven for both turn insertion and turn settlement. Attribute-driven changes such as `aria-busy` / `data-generating` clearing must be sufficient to trigger the post-generation re-collapse path without refresh.
- Background, popup, and options communicate only through typed runtime messages.
- Popup stats must query the active content tab first and use background state only as a fallback when MV3 worker suspension has dropped cached state.
- Storage access is asynchronous and must never block DOM mutation handling on the hot path.
- Live ChatGPT adapter logic must prefer outer `section[data-testid^="conversation-turn-"][data-turn]` roots over nested `[data-message-author-role]` descendants so real message DOM is not double-counted.
- Site-owned quick-jump rails are optional integrations. If a rail is present, delegated click handling may restore a collapsed target range; if the rail is absent or ambiguous, native site behavior must remain untouched.

## Verification Plan

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:playwright`
- Optional live smoke: `pnpm test:live` with a signed-in browser profile.
- Session bootstrap and session-change tests must assert that no `setInterval` polling is introduced.
- Session-controller tests must assert that generation settlement, driven by DOM attribute changes, re-applies the auto window without refresh.
- Session-controller tests must assert that site quick-jump clicks restore collapsed targets only on unique high-confidence matches.
- Real-page A/B debugging must compare the same conversation with the extension disabled and enabled before performance claims are treated as fixed.
- When real ChatGPT DOM contracts change, update the fixture pages to mirror the validated shape before treating the adapter as current.

## Acceptance Mapping

- FR-01 and FR-02 map to adapter and record-engine tests.
- FR-03, FR-04, and FR-06 map to virtualization and Playwright restore tests.
- FR-05 and FR-07 map to native-find restoration and snapshot-store tests.
- FR-08 maps to the live smoke and fixture-based Playwright harness.
- Sidebar false-positive protection maps to the adapter fixture that combines `nav[aria-label="Chat history"]` with the real `div[data-scroll-root]` thread layout.
- Blank new-chat handling maps to the fixture popup test that expects `No active conversation`.

## Failure Boundaries

- Unknown page structure: no virtualization, no DOM mutation beyond the injected shell.
- Snapshot restore failure during top-triggered restore: leave the collapsed group in place.
- Snapshot restore failure during native find: reveal the plain-text reservoir so browser-native find still resolves.
- Session switch during restore: cancel work and restart against the new session.
- Duplicate site re-render: dedupe by record signature before recomputing ranges.
- Quick-jump match ambiguity: do not intercept the site click; leave the native site jump behavior intact.
