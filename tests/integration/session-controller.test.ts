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
      generating:
        element.dataset.generating === 'true' ||
        element.getAttribute('aria-busy') === 'true' ||
        element.querySelector('[aria-busy="true"], [data-writing-block]') !== null
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

  isEditMessageTrigger(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('button[aria-label="Edit message"]') !== null;
  }

  isNativeEditActive(): boolean {
    return document.querySelector('textarea[aria-label="Edit message"]') !== null;
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

  markAssistantHydrating(recordIndex: number): void {
    const assistant = this.getAssistantTurnByRecordIndex(recordIndex);
    assistant.setAttribute('aria-busy', 'true');
  }

  appendDescendantBusyToAssistant(recordIndex: number): void {
    const assistant = this.getAssistantTurnByRecordIndex(recordIndex);
    const busy = document.createElement('div');
    busy.dataset.writingBlock = 'true';
    busy.setAttribute('aria-busy', 'true');
    busy.textContent = 'Hydrating';
    assistant.append(busy);
  }

  clearAssistantBusy(recordIndex: number): void {
    const assistant = this.getAssistantTurnByRecordIndex(recordIndex);
    assistant.removeAttribute('aria-busy');
    assistant.querySelectorAll('[aria-busy="true"], [data-writing-block]').forEach((node) => node.remove());
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

  private getAssistantTurnByRecordIndex(recordIndex: number): HTMLElement {
    const assistant = Array.from(this.thread.querySelectorAll<HTMLElement>('section[data-turn="assistant"]'))[recordIndex];
    if (!assistant) {
      throw new Error(`missing assistant turn for record ${recordIndex}`);
    }

    return assistant;
  }
}

class EditableChatGptAdapter implements PageAdapter {
  private readonly scrollRoot: HTMLElement;
  private readonly thread: HTMLElement;
  private readonly hostNoiseRoot: HTMLElement;
  private readonly records: Array<{ question: string; answer: string }> = [];
  private editActive = false;

  constructor(initialQaCount: number) {
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
    this.hostNoiseRoot = document.createElement('div');
    this.hostNoiseRoot.dataset.hostNoise = '';
    document.body.append(this.scrollRoot);
    document.body.append(this.hostNoiseRoot);

    for (let index = 1; index <= initialQaCount; index += 1) {
      this.records.push({
        question: `Question ${index}`,
        answer: `Answer ${index}`
      });
    }

    this.renderConversation();
  }

  canHandlePage(): boolean {
    return this.collectTurnCandidates().length >= 2;
  }

  getSessionId(): string {
    return 'editable-session';
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

  isEditMessageTrigger(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && target.closest('button[aria-label="Edit message"]') !== null;
  }

  isNativeEditActive(): boolean {
    return this.editActive && document.querySelector('textarea[aria-label="Edit message"]') !== null;
  }

  clickFirstEditButton(): void {
    const button = this.thread.querySelector<HTMLButtonElement>('button[aria-label="Edit message"]');
    if (!button) {
      throw new Error('expected an edit button');
    }

    button.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true
      })
    );

    window.setTimeout(() => {
      if (document.querySelector('.ecv-record-root, .ecv-collapsed-group')) {
        this.thread.innerHTML = '<div class="composer-parent flex flex-1 flex-col focus-visible:outline-0"></div>';
        this.editActive = false;
        return;
      }

      this.enterEditMode();
    }, 0);
  }

  finishEditMode(): void {
    this.editActive = false;
    this.renderConversation();
  }

  finishEditModeWithVisibleSlice(startIndex: number, count: number): void {
    this.editActive = false;
    this.renderConversationSlice(startIndex, count);
  }

  submitEditWithDelayedRecovery(delayMs: number): void {
    this.editActive = false;
    this.thread.innerHTML = '';
    this.thread.append(
      createTurn('conversation-turn-1', 'turn-1', 'user', 'You said:', 'Edited Question 1'),
      createTurn('conversation-turn-2', 'turn-2', 'assistant', 'ChatGPT said:', 'Draft replacement answer')
    );

    window.setTimeout(() => {
      this.records[0] = {
        question: 'Edited Question 1',
        answer: 'Replacement Answer 1'
      };
      this.renderConversation();
    }, delayMs);
  }

  submitEditWithPartialRecovery(delayMs: number, startIndex: number, count: number): void {
    this.editActive = false;
    this.thread.innerHTML = '';
    this.thread.append(
      createTurn('conversation-turn-1', 'turn-1', 'user', 'You said:', 'Edited Question 1'),
      createTurn('conversation-turn-2', 'turn-2', 'assistant', 'ChatGPT said:', 'Draft replacement answer')
    );

    window.setTimeout(() => {
      this.records[0] = {
        question: 'Edited Question 1',
        answer: 'Replacement Answer 1'
      };
      this.renderConversationSlice(startIndex, count);
    }, delayMs);
  }

  submitEditWithSinglePassRecoverySlice(delayMs: number, startIndex: number, count: number): void {
    window.setTimeout(() => {
      this.editActive = false;
      this.records[0] = {
        question: 'Edited Question 1',
        answer: 'Replacement Answer 1'
      };
      this.renderConversationSlice(startIndex, count);
    }, delayMs);
  }

  restoreFullConversation(): void {
    this.renderConversation();
  }

  startHostNoise(iterations: number, intervalMs: number): void {
    const tick = (remaining: number) => {
      this.hostNoiseRoot.textContent = `noise-${remaining}`;
      if (remaining <= 1) {
        return;
      }

      window.setTimeout(() => {
        tick(remaining - 1);
      }, intervalMs);
    };

    tick(iterations);
  }

  private enterEditMode(): void {
    this.editActive = true;
    const first = this.records[0];
    if (!first) {
      throw new Error('expected a first record');
    }

    this.thread.innerHTML = '';
    const composerParent = document.createElement('div');
    composerParent.className = 'composer-parent flex flex-1 flex-col focus-visible:outline-0';
    const textarea = document.createElement('textarea');
    textarea.setAttribute('aria-label', 'Edit message');
    textarea.value = first.question;
    composerParent.append(
      textarea,
      createTurn('conversation-turn-2', 'turn-2', 'assistant', 'ChatGPT said:', first.answer)
    );
    this.thread.append(composerParent);
  }

  private renderConversation(): void {
    this.thread.innerHTML = '';
    this.renderConversationSlice(0, this.records.length);
  }

  private renderConversationSlice(startIndex: number, count: number): void {
    this.thread.innerHTML = '';
    const visibleRecords = this.records.slice(startIndex, startIndex + count);
    visibleRecords.forEach((record, visibleIndex) => {
      const index = startIndex + visibleIndex;
      const userTurnIndex = index * 2 + 1;
      const assistantTurnIndex = userTurnIndex + 1;
      this.thread.append(
        createEditableUserTurn(`conversation-turn-${userTurnIndex}`, `turn-${userTurnIndex}`, record.question),
        createTurn(`conversation-turn-${assistantTurnIndex}`, `turn-${assistantTurnIndex}`, 'assistant', 'ChatGPT said:', record.answer)
      );
    });
  }
}

class ReplacingScrollRootAdapter implements PageAdapter {
  private scrollRoot: HTMLElement;
  private thread: HTMLElement;
  private readonly records: Array<{ question: string; answer: string }> = [];

  constructor(initialQaCount: number) {
    for (let index = 1; index <= initialQaCount; index += 1) {
      this.records.push({
        question: `Question ${index}`,
        answer: `Answer ${index}`
      });
    }

    const mounted = this.mountFreshScrollRoot();
    this.scrollRoot = mounted.scrollRoot;
    this.thread = mounted.thread;
  }

  canHandlePage(): boolean {
    return this.collectTurnCandidates().length >= 2;
  }

  getSessionId(): string {
    return 'replacing-scroll-root-session';
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

  replaceScrollRootPreservingConversation(): void {
    this.scrollRoot.remove();
    const mounted = this.mountFreshScrollRoot();
    this.scrollRoot = mounted.scrollRoot;
    this.thread = mounted.thread;
  }

  private mountFreshScrollRoot(): { scrollRoot: HTMLElement; thread: HTMLElement } {
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
    document.body.append(scrollRoot);

    this.records.forEach((record, index) => {
      const userTurnIndex = index * 2 + 1;
      const assistantTurnIndex = userTurnIndex + 1;
      thread.append(
        createTurn(`conversation-turn-${userTurnIndex}`, `turn-${userTurnIndex}`, 'user', 'You said:', record.question),
        createTurn(`conversation-turn-${assistantTurnIndex}`, `turn-${assistantTurnIndex}`, 'assistant', 'ChatGPT said:', record.answer)
      );
    });

    return {
      scrollRoot,
      thread
    };
  }
}

class SwitchableSessionAdapter implements PageAdapter {
  private currentSessionId = 'switch-session-a';
  private scrollRoot: HTMLElement | null = null;
  private thread: HTMLElement | null = null;
  private readonly callbacks = new Set<() => void>();

  constructor(initialQaCount: number) {
    this.renderSession(initialQaCount);
  }

  canHandlePage(): boolean {
    return this.collectTurnCandidates().length >= 2;
  }

  getSessionId(): string {
    return this.currentSessionId;
  }

  getScrollContainer(): HTMLElement | null {
    return this.scrollRoot;
  }

  collectTurnCandidates(): TurnCandidate[] {
    if (!this.thread) {
      return [];
    }

    return Array.from(this.thread.querySelectorAll<HTMLElement>('section[data-testid^="conversation-turn-"]')).map((element) => ({
      id: element.dataset.turnId ?? 'missing-turn-id',
      role: element.dataset.turn as TurnRole,
      text: element.textContent?.trim() ?? '',
      element
    }));
  }

  observeSessionChanges(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  getConfidence(): number {
    return 0.9;
  }

  switchSession(nextSessionId: string): void {
    this.currentSessionId = nextSessionId;
    window.history.replaceState({}, '', `/c/${nextSessionId}`);
    this.emitChange();
    this.clearDom();
  }

  switchSessionWithoutCallback(nextSessionId: string): void {
    this.currentSessionId = nextSessionId;
    window.history.replaceState({}, '', `/c/${nextSessionId}`);
    this.clearDom();
  }

  renderCurrentSession(qaCount: number): void {
    this.renderSession(qaCount);
  }

  private renderSession(qaCount: number): void {
    this.clearDom();

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
    document.body.append(scrollRoot);

    for (let index = 1; index <= qaCount; index += 1) {
      const userTurnIndex = index * 2 - 1;
      const assistantTurnIndex = userTurnIndex + 1;
      thread.append(
        createTurn(`conversation-turn-${userTurnIndex}`, `${this.currentSessionId}-turn-${userTurnIndex}`, 'user', 'You said:', `Question ${index}`),
        createTurn(
          `conversation-turn-${assistantTurnIndex}`,
          `${this.currentSessionId}-turn-${assistantTurnIndex}`,
          'assistant',
          'ChatGPT said:',
          `Answer ${index}`
        )
      );
    }

    this.scrollRoot = scrollRoot;
    this.thread = thread;
  }

  private clearDom(): void {
    this.scrollRoot?.remove();
    this.scrollRoot = null;
    this.thread = null;
  }

  private emitChange(): void {
    for (const callback of this.callbacks) {
      callback();
    }
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

  test('uses a short first-pass activation quiet window instead of waiting for the full reindex debounce', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';

    const adapter = new DelayedChatGptAdapter();
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      })
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();

      adapter.mountConversation();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(2);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(2);
      });

      await startPromise;
    } finally {
      controller.stop();
      vi.useRealTimers();
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
      await vi.advanceTimersByTimeAsync(100);

      expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(200);
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

  test('pressure-relieves a bootstrapping thread once it grows past the window without waiting for the full steady debounce', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new DynamicChatGptAdapter(1);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-bootstrap-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(1);
        expect(controller.getStats().mountedCount).toBe(1);
      });

      for (let index = 2; index <= 12; index += 1) {
        adapter.appendQa(`Question ${index}`, `Answer ${index}`);
      }

      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(400);

      expect(controller.getStats().totalRecords).toBe(12);
      expect(controller.getStats().mountedCount).toBe(10);
      expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      expect((controller as unknown as { currentSessionState?: { phase?: string } }).currentSessionState?.phase).toBe('bootstrapping');

      await vi.advanceTimersByTimeAsync(700);

      expect((controller as unknown as { currentSessionState?: { phase?: string } }).currentSessionState?.phase).toBe('steady');
      await startPromise;
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('ignores historical hydrate-busy assistant turns when computing the auto window', async () => {
    document.body.innerHTML = '';
    const adapter = new DynamicChatGptAdapter(12);
    adapter.markAssistantHydrating(0);
    adapter.markAssistantHydrating(2);

    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-hydrate-busy-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(12);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      const mountedIndices = Array.from(document.querySelectorAll<HTMLElement>('.ecv-record-root')).map((element) =>
        Number(element.dataset.recordIndex)
      );
      expect(mountedIndices).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
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

  test('reindexes when busy descendants inside an existing turn settle and re-compresses without refresh', async () => {
    document.body.innerHTML = '';
    const adapter = new DynamicChatGptAdapter(10);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-descendant-busy-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
      });

      adapter.appendQa('Question 11', 'Answer 11');
      adapter.appendDescendantBusyToAssistant(10);

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(11);
        expect(controller.getStats().mountedCount).toBe(11);
      });

      adapter.clearAssistantBusy(10);

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
    }
  });

  test('suspends virtualization for native edit mode and restores the window after edit mode exits', async () => {
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(12);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-edit-mode-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      adapter.clickFirstEditButton();

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
        expect(document.querySelector('textarea[aria-label="Edit message"]')).not.toBeNull();
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);
      });

      adapter.finishEditMode();

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(false);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
    }
  });

  test('waits for post-edit DOM recovery to settle before rebuilding virtualization after edit send', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(12);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-edit-send-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await startPromise;

      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      adapter.clickFirstEditButton();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
        expect(document.querySelector('textarea[aria-label="Edit message"]')).not.toBeNull();
      });

      adapter.submitEditWithDelayedRecovery(600);

      await vi.advanceTimersByTimeAsync(500);
      expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);
      expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);
      expect(controller.getStats().totalRecords).toBe(12);

      await vi.advanceTimersByTimeAsync(500);
      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(false);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('suspends native edit even before the first virtualization pass has attached', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(12);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-early-edit-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();

      adapter.clickFirstEditButton();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
        expect(document.querySelector('textarea[aria-label="Edit message"]')).not.toBeNull();
      });

      await vi.advanceTimersByTimeAsync(400);
      expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);
      expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);

      adapter.submitEditWithDelayedRecovery(600);

      await vi.advanceTimersByTimeAsync(500);
      expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);
      expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(false);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      await startPromise;
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('restores the preserved record set after edit cancel when ChatGPT only re-renders the visible slice', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(13);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-edit-cancel-slice-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await startPromise;

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      adapter.clickFirstEditButton();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
      });

      adapter.finishEditModeWithVisibleSlice(3, 10);
      await vi.advanceTimersByTimeAsync(1_100);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(false);
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
        expect(document.querySelector('[data-record-id="editable-session:record:12"]')).not.toBeNull();
      });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('keeps virtualization suspended after edit send until the full thread is safe to recover', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(13);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-edit-send-suspend-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await startPromise;

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      adapter.clickFirstEditButton();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
      });

      adapter.submitEditWithPartialRecovery(600, 0, 2);
      await vi.advanceTimersByTimeAsync(1_700);

      expect(adapter.isNativeEditActive()).toBe(false);
      expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);
      expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);
      expect(controller.getStats().mountedCount).toBe(0);
      expect(controller.getStats().totalRecords).toBe(13);

      adapter.restoreFullConversation();
      await vi.advanceTimersByTimeAsync(1_100);

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('recovers from native edit when ChatGPT only restores a smaller tail slice after scrolling to the bottom', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(13);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-edit-tail-slice-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await startPromise;

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      adapter.clickFirstEditButton();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
      });

      adapter.submitEditWithPartialRecovery(600, 6, 7);
      await vi.advanceTimersByTimeAsync(1_100);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(false);
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
        expect(document.querySelector('[data-record-id="editable-session:record:12"]')).not.toBeNull();
      });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('recovers when edit mode exits directly into a smaller tail slice without a second mutation batch', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(13);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-edit-single-pass-tail-slice-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await startPromise;

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
      });

      adapter.clickFirstEditButton();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
      });

      adapter.submitEditWithSinglePassRecoverySlice(600, 6, 7);
      await vi.advanceTimersByTimeAsync(700);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(false);
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('recovers from native edit even while unrelated host mutations keep firing during post-edit recovery', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(13);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-edit-recovery-churn-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await startPromise;

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
      });

      adapter.clickFirstEditButton();
      await vi.advanceTimersByTimeAsync(0);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
      });

      adapter.finishEditModeWithVisibleSlice(3, 10);
      adapter.startHostNoise(30, 100);

      await vi.advanceTimersByTimeAsync(1_500);

      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(false);
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('re-suspends when the recovered thread is cleared again before ChatGPT finishes rebuilding', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    const adapter = new EditableChatGptAdapter(13);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 1_000,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-edit-dom-loss-test')
    });

    try {
      const startPromise = controller.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(300);
      await startPromise;

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
      });

      adapter.clickFirstEditButton();
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => {
        expect(adapter.isNativeEditActive()).toBe(true);
      });

      adapter.finishEditModeWithVisibleSlice(3, 10);
      await vi.advanceTimersByTimeAsync(1_100);
      await vi.waitFor(() => {
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(10);
      });

      const thread = document.querySelector('#thread');
      if (!thread) {
        throw new Error('expected thread root');
      }
      thread.innerHTML = '';

      await vi.advanceTimersByTimeAsync(20);
      await vi.waitFor(() => {
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(0);
      });

      adapter.restoreFullConversation();
      await vi.advanceTimersByTimeAsync(1_100);
      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(13);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
      vi.useRealTimers();
    }
  });

  test('recovers when ChatGPT replaces the active scroll container and keeps stats in sync with the visible thread', async () => {
    document.body.innerHTML = '';
    const adapter = new ReplacingScrollRootAdapter(12);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-scroll-root-replacement-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(12);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });

      adapter.replaceScrollRootPreservingConversation();

      await vi.waitFor(() => {
        expect(controller.getStats().totalRecords).toBe(12);
        expect(controller.getStats().mountedCount).toBe(10);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(10);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      });
    } finally {
      controller.stop();
    }
  });

  test('resets session stats promptly on route change instead of keeping the previous thread active while the next one loads', async () => {
    document.body.innerHTML = '';
    const adapter = new SwitchableSessionAdapter(12);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-session-switch-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().sessionId).toBe('switch-session-a');
        expect(controller.getStats().totalRecords).toBe(12);
        expect(controller.getStats().mountedCount).toBe(10);
      });

      adapter.switchSession('switch-session-b');

      await vi.waitFor(() => {
        expect(controller.getStats().sessionId).toBe('switch-session-b');
        expect(controller.getStats().totalRecords).toBe(0);
        expect(controller.getStats().mountedCount).toBe(0);
        expect(document.querySelectorAll('.ecv-record-root')).toHaveLength(0);
        expect(document.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);
      });

      adapter.renderCurrentSession(6);

      await vi.waitFor(() => {
        expect(controller.getStats().sessionId).toBe('switch-session-b');
        expect(controller.getStats().totalRecords).toBe(6);
        expect(controller.getStats().mountedCount).toBe(6);
      });
    } finally {
      controller.stop();
    }
  });

  test('falls back to DOM health recovery when the route changes but no explicit session-change callback fires', async () => {
    document.body.innerHTML = '';
    const adapter = new SwitchableSessionAdapter(12);
    const controller = new SessionController({
      adapter,
      configStore: new StaticConfigStore({
        stabilityQuietMs: 10,
        enableVirtualization: true,
        windowSizeQa: 10
      }),
      snapshotStore: new IndexedDbSnapshotStore('ecv-session-controller-session-switch-health-test')
    });

    try {
      await controller.start();

      await vi.waitFor(() => {
        expect(controller.getStats().sessionId).toBe('switch-session-a');
        expect(controller.getStats().totalRecords).toBe(12);
        expect(controller.getStats().mountedCount).toBe(10);
      });

      adapter.switchSessionWithoutCallback('switch-session-b');

      await vi.waitFor(() => {
        expect(controller.getStats().sessionId).toBe('switch-session-b');
        expect(controller.getStats().totalRecords).toBe(0);
        expect(controller.getStats().mountedCount).toBe(0);
      });

      adapter.renderCurrentSession(6);

      await vi.waitFor(() => {
        expect(controller.getStats().sessionId).toBe('switch-session-b');
        expect(controller.getStats().totalRecords).toBe(6);
        expect(controller.getStats().mountedCount).toBe(6);
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

function createEditableUserTurn(testId: string, turnId: string, text: string): HTMLElement {
  const section = createTurn(testId, turnId, 'user', 'You said:', text);
  const actions = document.createElement('div');
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Edit message');
  button.textContent = 'Edit';
  actions.append(button);
  section.append(actions);
  return section;
}
