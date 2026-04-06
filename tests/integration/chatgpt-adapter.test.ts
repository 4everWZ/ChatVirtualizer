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

  test('prefers outer live turn sections over nested author-role nodes on real ChatGPT layouts', () => {
    document.body.innerHTML = `
      <div data-scroll-root style="height: 800px; overflow-y: auto;">
        <main id="main">
          <div id="thread">
            <section data-testid="conversation-turn-1" data-turn-id="turn-1" data-turn="user">
              <div data-message-author-role="user">Question 1</div>
            </section>
            <section data-testid="conversation-turn-2" data-turn-id="turn-2" data-turn="assistant">
              <div data-message-author-role="assistant">Answer 1</div>
            </section>
            <section data-testid="conversation-turn-3" data-turn-id="turn-3" data-turn="user">
              <div data-message-author-role="user">Question 2</div>
            </section>
            <section data-testid="conversation-turn-4" data-turn-id="turn-4" data-turn="assistant">
              <div data-message-author-role="assistant">Answer 2</div>
            </section>
          </div>
        </main>
      </div>
    `;

    const adapter = new ChatGptPageAdapter(document);
    const turns = adapter.collectTurnCandidates();

    expect(turns).toHaveLength(4);
    expect(turns.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2', 'turn-3', 'turn-4']);
    expect(turns.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  test('exposes quick-jump hooks only when the site quick-jump panel exists', () => {
    document.body.innerHTML = `
      <div data-scroll-root style="height: 800px; overflow-y: auto;">
        <main id="main">
          <div id="thread">
            <section data-testid="conversation-turn-1" data-turn-id="turn-1" data-turn="user">Question 1</section>
            <section data-testid="conversation-turn-2" data-turn-id="turn-2" data-turn="assistant">Answer 1</section>
          </div>
        </main>
      </div>
      <div class="fixed end-4 top-1/2 z-20 -translate-y-1/2">
        <button data-quick-jump-item="true"><span>Question 1</span></button>
      </div>
    `;

    const adapter = new ChatGptPageAdapter(document);
    const quickJumpContainer = adapter.getQuickJumpContainer?.();
    const labelTarget = document.querySelector('button span');

    expect(quickJumpContainer).not.toBeNull();
    expect(adapter.extractQuickJumpText?.(labelTarget ?? null)).toBe('Question 1');
  });
});
