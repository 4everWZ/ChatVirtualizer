import { derivePendingSessionStatsFromTab } from '@/background/service-worker';

describe('service worker stats fallback', () => {
  test('derives zeroed pending stats from the active ChatGPT conversation URL instead of reusing stale cached session data', () => {
    expect(
      derivePendingSessionStatsFromTab({
        active: true,
        url: 'https://chatgpt.com/c/69ce6bac-b5b8-839f-880d-b77069b4f15a'
      } as chrome.tabs.Tab)
    ).toEqual({
      adapterConfidence: 0,
      collapsedGroupCount: 0,
      mountedCount: 0,
      sessionId: '69ce6bac-b5b8-839f-880d-b77069b4f15a',
      totalRecords: 0
    });
  });

  test('returns no-active-conversation stats for non-conversation ChatGPT pages', () => {
    expect(
      derivePendingSessionStatsFromTab({
        active: true,
        url: 'https://chatgpt.com/'
      } as chrome.tabs.Tab)
    ).toEqual({
      adapterConfidence: 0,
      collapsedGroupCount: 0,
      mountedCount: 0,
      sessionId: 'No active conversation',
      totalRecords: 0
    });
  });
});
