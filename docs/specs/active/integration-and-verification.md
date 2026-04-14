# Integration And Verification Spec

## Summary

The system is assembled around a session controller that coordinates adapter discovery, record indexing, virtualization, native-find restoration, storage, and runtime messaging. Every boundary that can fail must degrade to a safe no-op or collapsed-group-preserving state.

## Integration Rules

- Content bootstrap owns initialization and exits quietly when the adapter cannot confidently support the page.
- If the adapter is not yet confident because live ChatGPT has not rendered turns, the content bootstrap must stay armed with a DOM-triggered activation watcher and retry instead of permanently exiting.
- Once the adapter becomes confident for the first time on a live thread, the first bootstrap pass must use a short activation quiet window rather than the full steady-state reindex debounce.
- After first activation, the session remains in an internal `bootstrapping` phase until a full `stabilityQuietMs` quiet period passes. Reindex work in that phase must keep using the short quiet window so old history is pressure-relieved as soon as provisional QA records exceed the tail budget.
- Runtime control flow must stay event-driven end to end. Timer polling, dead loops, busy waits, and long-running CPU spin used only to simplify implementation are forbidden.
- Session rebuilds are atomic from the content script’s perspective: cancel pending work, rebuild records, re-evaluate the mounted window, then publish stats.
- Same-session tail growth must prefer incremental reconcile over full session rebuild when the mounted visible tail is still structurally compatible.
- Initial history collapse must not synchronously wait for slow IndexedDB persistence before removing eligible old records from the live DOM.
- Initial history collapse must not force synchronous layout reads or eager HTML snapshot generation on the live-page hot path.
- The steady-state mounted window must split into `live`, `lite`, and `collapsed` records. Only the newest hot subset stays as full ChatGPT DOM by default; older visible records must use lighter reading-state wrappers.
- Mutation handling must remain event-driven for both turn insertion and turn settlement. Attribute-driven changes such as `aria-busy` / `data-generating` clearing must be sufficient to trigger the post-generation re-collapse path without refresh.
- Child-node changes inside an existing turn must also count as relevant settlement signals when they add or remove busy descendants such as hydration markers or writing blocks.
- Native ChatGPT edit mode must suspend mutation-driven virtualization work entirely. While the site owns the edit DOM, no reindex or re-collapse path may keep running against the thread, including the pre-attach bootstrap window, and rebuild after edit exit must wait for the full steady-state quiet window rather than the short activation window.
- Post-edit recovery must not trust the first supported DOM subtree blindly. If the returned turns can be merged against the preserved pre-edit records, the controller may resume virtualization; if the returned DOM is still obviously partial, the controller must remain suspended and wait for more DOM evidence instead of rebuilding a corrupt window.
- If ChatGPT clears the recovered DOM again during the same post-edit transition, the controller must treat that as renewed instability, re-suspend virtualization, and wait for a later safe recovery point rather than keeping stale mounted state.
- Window application must never evict the entire currently visible record set unless at least one replacement record has already been kept or restored successfully. A bad or partial plan is allowed to degrade to "keep the current window" but not to a blank thread with only collapsed history chrome.
- If ChatGPT replaces the active scroll root or mounted record subtree without a clean session-change callback, DOM-health recovery must still detect the loss, clear stale mounted bookkeeping, and rebuild or suspend safely.
- Background, popup, and options communicate only through typed runtime messages.
- Popup stats must query the active content tab first and use background state only as a fallback when MV3 worker suspension has dropped cached state.
- When the active content tab is mid-navigation and direct tab messaging is unavailable or still returning an empty/unstable thread, popup-visible stats must prefer the current tab URL's conversation id with zeroed counts over stale cached stats from the previous conversation.
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
- Session-controller tests must assert that historical hydrate-busy assistant turns do not pin old records in the mounted set.
- Session-controller tests must assert that the first supported-thread bootstrap completes before the full `stabilityQuietMs` steady-state debounce elapses.
- Session-controller tests must assert that a thread which starts below the window and later grows past it is pressure-relieved during `bootstrapping` without waiting for the full steady-state debounce.
- Session-controller tests must assert that site quick-jump clicks restore collapsed targets only on unique high-confidence matches.
- Session-controller tests must assert that native `Edit message` removes extension-owned wrappers and collapsed groups during edit mode, restores preserved history when cancel only re-renders the current window, and refuses to rebuild when post-send DOM is still an incomplete fragment.
- Session-controller tests must also assert that post-edit DOM loss after an initial recovery attempt forces a second suspension instead of leaving stale mounted stats or orphaned collapsed groups behind.
- Session-controller tests must assert that host-owned scroll-root replacement and DOM-only route drift recover to the right session instead of leaving a blank thread with stale counts.
- Virtualization tests must assert that direct interaction with a visible `lite` record promotes it back into the live subset and demotes the oldest unprotected hot record.
- Virtualization tests must assert that a failed replacement restore cannot evict the entire visible window.
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
