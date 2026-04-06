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

class DynamicChatGptAdapter implements PageAdapter {
  private readonly scrollRoot: HTMLElement;
  private readonly thread: HTMLElement;
  private readonly quickJumpContainer: HTMLElement;
  private turnCounter = 0;

  constructor(initialQaCount: number) {
    this.scrollRoot = document.createElement('div');
    this.scrollRoot.dataset.scrollRoot = '';
    this.scrollRoot.style.height = '800px';
    this.scrollRoot.style.overflowY = 'auto';

    Object.defineProperty(this.scrollRoot, 'scrollHeight', {
      configurable: true,
      get: () => 2400
    });
    Object.defineProperty(this.scrollRoot, 'clientHeight', {
      configurable: true,
      get: () => 600
    });

    const main = document.createElement('main');
    main.id = 'main';
    this.thread = document.createElement('div');
    this.thread.id = 'thread';
    main.append(this.thread);
    this.scrollRoot.append(main);
    document.body.append(this.scrollRoot);

    this.quickJumpContainer = document.createElement('div');
    this.quickJumpContainer.className = 'fixed end-4 top-1/2 z-20 -translate-y-1/2';
    document.body.append(this.quickJumpContainer);

    for (let index = 1; index <= initialQaCount; index += 1) {
      this.appendQa(`Question ${index}`, `Answer ${index}`);
      this.addQuickJumpItem(`Question ${index}`);
    }
  }

  canHandlePage(): boolean {
    return this.collectTurnCandidates().length >= 2;
  }

  getSessionId(): string {
    return 'dynamic-session';
  }

  getScrollContainer(): HTMLElement | null {
    return this.scrollRoot;
  }

  collectTurnCandidates(): TurnCandidate[] {
    return Array.from(this.thread.querySelectorAll<HTMLElement>('section[data-testid^="conversation-turn-"]')).map((element) => ({
      id: element.dataset.turnId ?? 'missing-turn-id',
      role: element.dataset.turn as TurnRole,
      text: element.textContent?.trim() ?? '',
      element,
      generating: element.dataset.generating === 'true'
    }));
  }

  observeSessionChanges(): () => void {
    return () => undefined;
  }

  getConfidence(): number {
    return 0.9;
  }

  getQuickJumpContainer(): HTMLElement | null {
    return this.quickJumpContainer;
  }

  extractQuickJumpText(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    return target.closest<HTMLElement>('[data-quick-jump-item]')?.textContent?.trim() ?? null;
  }

  appendQa(question: string, answer: string): void {
    const userIndex = ++this.turnCounter;
    const assistantIndex = ++this.turnCounter;
    this.thread.append(
      createTurn(`conversation-turn-${userIndex}`, `turn-${userIndex}`, 'user', 'You said:', question),
      createTurn(`conversation-turn-${assistantIndex}`, `turn-${assistantIndex}`, 'assistant', 'ChatGPT said:', answer)
    );
  }

  appendGeneratingAssistant(question: string, answer = 'Draft answer'): void {
    const userIndex = ++this.turnCounter;
    const assistantIndex = ++this.turnCounter;
    const assistant = createTurn(`conversation-turn-${assistantIndex}`, `turn-${assistantIndex}`, 'assistant', 'ChatGPT said:', answer);
    assistant.dataset.generating = 'true';
    assistant.setAttribute('aria-busy', 'true');

    this.thread.append(createTurn(`conversation-turn-${userIndex}`, `turn-${userIndex}`, 'user', 'You said:', question), assistant);
  }

  finishLatestAssistant(finalAnswer: string): void {
    const assistant = Array.from(this.thread.querySelectorAll<HTMLElement>('section[data-turn="assistant"]')).at(-1);
    if (!assistant) {
      throw new Error('expected an assistant turn to finish');
    }

    assistant.dataset.generating = 'false';
    assistant.removeAttribute('aria-busy');
    const content = assistant.querySelector('div');
    if (content) {
      content.textContent = finalAnswer;
    }
  }

  getQuickJumpItem(label: string): HTMLElement {
    const item = Array.from(this.quickJumpContainer.querySelectorAll<HTMLElement>('[data-quick-jump-item]')).find(
      (element) => element.textContent?.trim() === label
    );
    if (!item) {
      throw new Error(`missing quick jump item for ${label}`);
    }

    return item;
  }

  private addQuickJumpItem(label: string): void {
    const button = document.createElement('button');
    button.dataset.quickJumpItem = 'true';
    button.textContent = label;
    this.quickJumpContainer.append(button);
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

  test('auto-compresses once stable records grow past the window without refresh', async () => {
    document.body.innerHTML = '';
    const adapter = new DynamicChatGptAdapter(9);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-grow-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(9);
        expect(controller.getStats().mountedCount).toBe(9);
      });

      adapter.appendQa('Question 10', 'Answer 10');
      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(10);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);
      });

      adapter.appendQa('Question 11', 'Answer 11');
      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(11);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
    }
  });

  test('keeps expanded history mounted until the user returns to the bottom zone', async () => {
    document.body.innerHTML = '';
    const adapter = new DynamicChatGptAdapter(12);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10,
        preloadBufferPx: 100
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-manual-mode-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(12);
        expect(controller.getStats().mountedCount).toBe(10);
      });

      await (controller as unknown as { restorePreviousBatch(): Promise<void> }).restorePreviousBatch();

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(12);
      });

      adapter.appendQa('Question 13', 'Answer 13');
      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(13);
      });

      const scrollContainer = adapter.getScrollContainer();
      if (!scrollContainer) {
        throw new Error('expected scroll container');
      }

      scrollContainer.scrollTop = 1800;
      scrollContainer.dispatchEvent(new Event('scroll'));

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
    }
  });

  test('restores collapsed history when a quick-jump target is clicked', async () => {
    document.body.innerHTML = '';
    const adapter = new DynamicChatGptAdapter(12);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10,
        searchContextBefore: 0,
        searchContextAfter: 1
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-jump-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      const quickJumpItem = adapter.getQuickJumpItem('Question 1');
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      });

      const dispatched = quickJumpItem.dispatchEvent(clickEvent);

      expect(dispatched).toBe(false);

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(12);
        expect(document.querySelector('[data-record-id="dynamic-session:record:0"]')).not.toBeNull();
      });
    } finally {
      controller.stop();
    }
  });

  test('does not keep extra mounted records after generating turns settle in auto mode', async () => {
    document.body.innerHTML = '';
    const adapter = new DynamicChatGptAdapter(10);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-generating-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
      });

      adapter.appendGeneratingAssistant('Question 11');
      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(11);
        expect(controller.getStats().mountedCount).toBe(11);
      });

      adapter.finishLatestAssistant('Answer 11');
      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
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
