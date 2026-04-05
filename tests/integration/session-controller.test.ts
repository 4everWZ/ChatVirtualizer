import { ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { SessionController } from '@/content/session-controller';
import { mergeConfig } from '@/shared/config';
import type { PageAdapter, TurnCandidate, TurnRole } from '@/shared/contracts';
import { ConfigStore } from '@/shared/storage/config-store';
import { IndexedDbSnapshotStore } from '@/shared/storage/snapshot-store';
import { vi } from 'vitest';
import { installFixtureDom } from '../helpers/fixture-dom';

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

class ProgressiveChatGptAdapter implements PageAdapter {
  private readonly scrollRoot: HTMLElement;
  private readonly thread: HTMLElement;

  constructor() {
    this.scrollRoot = document.createElement('div');
    this.scrollRoot.dataset.scrollRoot = '';
    this.scrollRoot.style.height = '800px';
    this.scrollRoot.style.overflowY = 'auto';

    const main = document.createElement('main');
    main.id = 'main';
    this.thread = document.createElement('div');
    this.thread.id = 'thread';
    main.append(this.thread);
    this.scrollRoot.append(main);
    document.body.append(this.scrollRoot);

    this.thread.append(
      createTurn('conversation-turn-1', 'turn-1', 'user', 'You said:', 'Question 1'),
      createTurn('conversation-turn-2', 'turn-2', 'assistant', 'ChatGPT said:', 'Answer 1')
    );
  }

  canHandlePage(): boolean {
    return this.collectTurnCandidates().length >= 2;
  }

  getSessionId(): string {
    return 'progressive-session';
  }

  getScrollContainer(): HTMLElement | null {
    return this.scrollRoot;
  }

  collectTurnCandidates(): TurnCandidate[] {
    return Array.from(this.thread.querySelectorAll<HTMLElement>('section[data-testid^="conversation-turn-"]')).map((element) => ({
      id: element.dataset.turnId ?? 'missing-turn-id',
      role: element.dataset.turn as TurnRole,
      text: element.textContent?.trim() ?? '',
      element
    }));
  }

  observeSessionChanges(): () => void {
    return () => undefined;
  }

  getConfidence(): number {
    return 0.9;
  }

  appendFollowUpTurns(): void {
    this.thread.append(
      createTurn('conversation-turn-3', 'turn-3', 'user', 'You said:', 'Question 2'),
      createTurn('conversation-turn-4', 'turn-4', 'assistant', 'ChatGPT said:', 'Answer 2')
    );
  }
}

describe('session controller', () => {
  test('activates after ChatGPT turns render asynchronously', async () => {
    const adapter = new DelayedChatGptAdapter();
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      })
    });
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

  test('does not rebuild virtualization on unrelated subtree mutations after initial collapse', async () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const controller = new SessionController({
      adapter: new ChatGptPageAdapter(document),
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      const initialRoots = document.querySelectorAll('.ecv-record-root').length;
      const initialGroups = document.querySelectorAll('.ecv-collapsed-group').length;

      const noise = document.createElement('div');
      noise.dataset.noise = 'true';
      document.querySelector('[data-scroll-root]')?.append(noise);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(initialRoots);
      expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(initialGroups);
    } finally {
      controller.stop();
    }
  });

  test('waits for turn loading to settle before first virtualization pass', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';

    const adapter = new ProgressiveChatGptAdapter();
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 20,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-progressive-session-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();

      expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);

      adapter.appendFollowUpTurns();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);

      expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(20);
      await startPromise;

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(2);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(2);
      });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('preserves collapsed history when new turns arrive after initial virtualization', async () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const controller = new SessionController({
      adapter: new ChatGptPageAdapter(document),
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-append-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(12);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      const thread = document.querySelector('#thread');
      if (!(thread instanceof HTMLElement)) {
        throw new Error('expected fixture thread root');
      }

      thread.append(
        createTurn('conversation-turn-25', 'turn-25', 'user', 'You said:', 'Question 13'),
        createTurn('conversation-turn-26', 'turn-26', 'assistant', 'ChatGPT said:', 'Answer 13')
      );

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
      });

      expect(controller.getStats().mountedCount).toBe(10);
      expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
    } finally {
      controller.stop();
    }
  });
});

class StaticConfigStore extends ConfigStore {
  constructor(private readonly overrides: Record<string, number | boolean>) {
    super();
  }

  override async getConfig() {
    return mergeConfig(this.overrides);
  }
}

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
