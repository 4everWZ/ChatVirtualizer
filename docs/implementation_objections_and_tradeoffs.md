# Implementation Objections And Tradeoffs

- **Original Spec/Idea:** Older history would be replaced with equal-height placeholders so the scroll range stayed visually stable.
- **Actual Implementation:** Older history is collapsed into compact grouped folds, each with one visible summary row and per-record `hidden="until-found"` reservoirs.
- **Reasoning:** The grouped folds materially shrink the scrollbar, which matches the current product requirement better than preserving the original scroll height.

- **Original Spec/Idea:** Search would be handled through a custom in-page overlay and popup-triggered search controls.
- **Actual Implementation:** Search is handled through browser-native find, with `beforematch` restoring the matched record and surrounding context from collapsed history.
- **Reasoning:** The browser-native flow matches the verified Gemini interaction model and avoids shortcut interception or extra page UI.

- **Original Spec/Idea:** Popup stats would rely on content-script updates cached in the MV3 background worker.
- **Actual Implementation:** Popup stats query the active content tab directly and use background state only as a fallback.
- **Reasoning:** MV3 service workers suspend aggressively, so direct content-tab queries keep popup state accurate after cache loss.

- **Original Spec/Idea:** Collapsed records would be serialized into sanitized IndexedDB snapshots as part of the live-page initial virtualization pass.
- **Actual Implementation:** Initial virtualization keeps collapsed records as detached DOM roots only for a short same-session TTL, prepares lightweight snapshots off the hot path, and releases the original detached DOM once a snapshot is ready and the TTL expires.
- **Reasoning:** Real ChatGPT A/B verification on April 6, 2026 showed that eager hot-path snapshot generation materially regressed live conversation load time, while indefinite detached-root retention left too much memory pressure. Deferred lightweight snapshots preserve fast short-range restore while allowing the old DOM tree to be released.
