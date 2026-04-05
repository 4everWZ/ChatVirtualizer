import { ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { installFixtureDom } from '../helpers/fixture-dom';

describe('chatgpt page adapter', () => {
  test('detects supported chat pages and extracts turn candidates', () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();

    expect(adapter.canHandlePage()).toBe(true);
    expect(adapter.getSessionId()).toBe('local-session');
    expect(scrollContainer?.dataset.scrollRoot).toBe('');

    const turns = adapter.collectTurnCandidates();

    expect(turns.length).toBeGreaterThan(10);
    expect(turns[0]?.role).toBe('user');
    expect(turns[0]?.id).toBe('turn-1');
    expect(turns[1]?.role).toBe('assistant');
  });

  test('fails closed on unknown layouts', () => {
    installFixtureDom('unknown-layout.html', 'https://chatgpt.com/c/unknown-session');

    const adapter = new ChatGptPageAdapter(document);

    expect(adapter.canHandlePage()).toBe(false);
    expect(adapter.collectTurnCandidates()).toHaveLength(0);
  });
});
