import { SessionController } from '@/content/session-controller';
import type { PageAdapter, TurnCandidate, TurnRole } from '@/shared/contracts';
import { vi } from 'vitest';

class DelayedChatGptAdapter implements PageAdapter {
  ready = false;
  private scrollContainer: HTMLElement | null = null;
  private turns: TurnCandidate[] = [];

  canHandlePage(): boolean {
    return this.ready && this.scrollContainer !== null && this.turns.length >= 2;
  }

  getSessionId(): string {
    return 'delayed-session';
  }

  getScrollContainer(): HTMLElement | null {
    return this.ready ? this.scrollContainer : null;
  }

  collectTurnCandidates(): TurnCandidate[] {
    return this.ready ? this.turns : [];
  }

  observeSessionChanges(): () => void {
    return () => undefined;
  }

  getConfidence(): number {
    return this.canHandlePage() ? 0.9 : 0.2;
  }

  mountConversation(): void {
    const scrollRoot = document.createElement('div');
    scrollRoot.dataset.scrollRoot = '';
    scrollRoot.style.height = '800px';
    scrollRoot.style.overflowY = 'auto';

    const main = document.createElement('main');
    main.id = 'main';
    const thread = document.createElement('div');
    thread.id = 'thread';
    main.append(thread);
    scrollRoot.append(main);

    thread.append(
      createTurn('conversation-turn-1', 'turn-1', 'user', 'You said:', 'Delayed question'),
      createTurn('conversation-turn-2', 'turn-2', 'assistant', 'ChatGPT said:', 'Delayed answer'),
      createTurn('conversation-turn-3', 'turn-3', 'user', 'You said:', 'Delayed follow-up'),
      createTurn('conversation-turn-4', 'turn-4', 'assistant', 'ChatGPT said:', 'Delayed second answer')
    );

    document.body.append(scrollRoot);

    this.scrollContainer = scrollRoot;
    this.turns = Array.from(thread.querySelectorAll<HTMLElement>('section[data-testid^="conversation-turn-"]')).map((element) => ({
      id: element.dataset.turnId ?? 'missing-turn-id',
      role: element.dataset.turn as TurnRole,
      text: element.textContent?.trim() ?? '',
      element
    }));
    this.ready = true;
  }
}

describe('session controller', () => {
  test('activates after ChatGPT turns render asynchronously', async () => {
    const adapter = new DelayedChatGptAdapter();
    const controller = new SessionController({ adapter });
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    try {
      await controller.start();
      expect(controller.getStats().totalRecords).toBe(0);
      expect(setIntervalSpy).not.toHaveBeenCalled();

      adapter.mountConversation();

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(2);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(2);
      });
    } finally {
      controller.stop();
      setIntervalSpy.mockRestore();
    }
  });
});

function createTurn(testId: string, turnId: string, role: TurnRole, label: string, text: string): HTMLElement {
  const section = document.createElement('section');
  section.dataset.testid = testId;
  section.setAttribute('data-testid', testId);
  section.dataset.turnId = turnId;
  section.dataset.turn = role;
  section.style.minHeight = '120px';

  const heading = document.createElement('h4');
  heading.className = 'sr-only select-none';
  heading.textContent = label;

  const content = document.createElement('div');
  content.textContent = text;

  section.append(heading, content);
  return section;
}
