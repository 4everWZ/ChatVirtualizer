import { ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { buildQaRecordsFromTurns } from '@/content/records/record-engine';
import type { RecordSnapshot, SnapshotStore } from '@/shared/contracts';
import { VirtualizationEngine } from '@/content/virtualization/virtualization-engine';
import { DEFAULT_CONFIG } from '@/shared/config';
import { IndexedDbSnapshotStore } from '@/shared/storage/snapshot-store';
import { vi } from 'vitest';
import { installFixtureDom } from '../helpers/fixture-dom';

describe('virtualization engine', () => {
  test('keeps only the newest four mounted records live and renders the older visible window as lite-readable content', async () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    for (const assistantTurn of document.querySelectorAll<HTMLElement>('section[data-turn="assistant"]')) {
      assistantTurn.append(
        createHeavyAction('copy-turn-action-button', 'Copy'),
        createHeavyAction('good-response-turn-action-button', 'Good'),
        createHeavyAction('bad-response-turn-action-button', 'Bad'),
        createCitationPill()
      );
    }

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();
    if (!scrollContainer) {
      throw new Error('expected fixture to expose a scroll container');
    }

    const records = buildQaRecordsFromTurns(adapter.collectTurnCandidates(), 'local-session');
    const engine = new VirtualizationEngine({
      config: DEFAULT_CONFIG,
      snapshotStore: new IndexedDbSnapshotStore('ecv-virtualizer-lite-window-test')
    });

    await engine.attach(scrollContainer, records);
    await engine.applyInitialWindow();

    const liveRoots = Array.from(scrollContainer.querySelectorAll<HTMLElement>('.ecv-record-root[data-render-mode="live"]'));
    const liteRoots = Array.from(scrollContainer.querySelectorAll<HTMLElement>('.ecv-record-root[data-render-mode="lite"]'));

    expect(liveRoots.map((element) => Number(element.dataset.recordIndex))).toEqual([8, 9, 10, 11]);
    expect(liteRoots.map((element) => Number(element.dataset.recordIndex))).toEqual([2, 3, 4, 5, 6, 7]);
    expect(scrollContainer.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);

    expect(liveRoots[0]?.querySelector('[data-testid="copy-turn-action-button"]')).not.toBeNull();
    expect(liveRoots[0]?.querySelector('[data-testid="webpage-citation-pill"]')).not.toBeNull();
    expect(liteRoots[0]?.querySelector('[data-testid="copy-turn-action-button"]')).toBeNull();
    expect(liteRoots[0]?.querySelector('[data-testid="webpage-citation-pill"]')).toBeNull();
  });

  test('promotes interacted lite records to live and demotes the oldest unprotected live record back to lite', async () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    for (const assistantTurn of document.querySelectorAll<HTMLElement>('section[data-turn="assistant"]')) {
      assistantTurn.append(createHeavyAction('copy-turn-action-button', 'Copy'));
    }

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();
    if (!scrollContainer) {
      throw new Error('expected fixture to expose a scroll container');
    }

    const records = buildQaRecordsFromTurns(adapter.collectTurnCandidates(), 'local-session');
    const engine = new VirtualizationEngine({
      config: DEFAULT_CONFIG,
      snapshotStore: new IndexedDbSnapshotStore('ecv-virtualizer-live-promotion-test')
    });

    await engine.attach(scrollContainer, records);
    await engine.applyInitialWindow();

    const promotedRoot = scrollContainer.querySelector<HTMLElement>('.ecv-record-root[data-record-index="5"]');
    if (!promotedRoot) {
      throw new Error('expected record 5 to be mounted as lite');
    }

    promotedRoot.dispatchEvent(
      new PointerEvent('pointerenter', {
        bubbles: true
      })
    );
    await Promise.resolve();

    const liveIndices = Array.from(scrollContainer.querySelectorAll<HTMLElement>('.ecv-record-root[data-render-mode="live"]')).map((element) =>
      Number(element.dataset.recordIndex)
    );
    const liteIndices = Array.from(scrollContainer.querySelectorAll<HTMLElement>('.ecv-record-root[data-render-mode="lite"]')).map((element) =>
      Number(element.dataset.recordIndex)
    );

    expect(liveIndices).toEqual([5, 9, 10, 11]);
    expect(liteIndices).toContain(8);
    expect(scrollContainer.querySelector<HTMLElement>('.ecv-record-root[data-record-index="5"] [data-testid="copy-turn-action-button"]')).not.toBeNull();
    expect(scrollContainer.querySelector<HTMLElement>('.ecv-record-root[data-record-index="8"] [data-testid="copy-turn-action-button"]')).toBeNull();
  });

  test('compresses older records into collapsed groups and restores them from native find hooks', async () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();
    if (!scrollContainer) {
      throw new Error('expected fixture to expose a scroll container');
    }

    const records = buildQaRecordsFromTurns(adapter.collectTurnCandidates(), 'local-session');
    const engine = new VirtualizationEngine({
      config: DEFAULT_CONFIG,
      snapshotStore: new IndexedDbSnapshotStore('ecv-virtualizer-test')
    });

    await engine.attach(scrollContainer, records);
    await engine.applyInitialWindow();

    expect(scrollContainer.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
    expect(scrollContainer.querySelectorAll('.ecv-placeholder')).toHaveLength(0);
    expect(scrollContainer.querySelectorAll('[hidden="until-found"][data-record-id]')).toHaveLength(2);
    expect(engine.getMountedCount()).toBe(10);

    const reservoir = scrollContainer.querySelector<HTMLElement>('[hidden="until-found"][data-record-id="local-session:record:0"]');
    if (!reservoir) {
      throw new Error('expected a search reservoir for the oldest collapsed record');
    }

    reservoir.dispatchEvent(new Event('beforematch'));
    await Promise.resolve();
    await Promise.resolve();

    expect(scrollContainer.querySelectorAll('.ecv-collapsed-group')).toHaveLength(0);
    expect(engine.getMountedCount()).toBe(12);
  });

  test('collapses history without waiting for slow snapshot persistence', async () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();
    if (!scrollContainer) {
      throw new Error('expected fixture to expose a scroll container');
    }

    const snapshotStore = new SlowSnapshotStore();
    const records = buildQaRecordsFromTurns(adapter.collectTurnCandidates(), 'local-session');
    const engine = new VirtualizationEngine({
      config: DEFAULT_CONFIG,
      snapshotStore
    });

    await engine.attach(scrollContainer, records);

    const applyPromise = engine.applyInitialWindow();
    await vi.waitFor(() => {
      expect(scrollContainer.querySelectorAll('.ecv-collapsed-group')).toHaveLength(1);
      expect(engine.getMountedCount()).toBe(10);
    });

    snapshotStore.flush();
    await applyPromise;
  });

  test('does not synchronously serialize evicted record html during initial collapse', async () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();
    if (!scrollContainer) {
      throw new Error('expected fixture to expose a scroll container');
    }

    const records = buildQaRecordsFromTurns(adapter.collectTurnCandidates(), 'local-session');
    const engine = new VirtualizationEngine({
      config: DEFAULT_CONFIG,
      snapshotStore: new IndexedDbSnapshotStore('ecv-virtualizer-html-test')
    });

    await engine.attach(scrollContainer, records);

    let innerHtmlReads = 0;
    for (const record of records.slice(0, 2)) {
      if (!record.rootElement) {
        throw new Error('expected attached records to have wrappers before collapse');
      }

      const originalInnerHtml = record.rootElement.innerHTML;
      Object.defineProperty(record.rootElement, 'innerHTML', {
        configurable: true,
        get() {
          innerHtmlReads += 1;
          return originalInnerHtml;
        }
      });
    }

    await engine.applyInitialWindow();

    expect(innerHtmlReads).toBe(0);
  });

  test('does not force synchronous layout reads during initial attach and collapse', async () => {
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();
    if (!scrollContainer) {
      throw new Error('expected fixture to expose a scroll container');
    }

    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const records = buildQaRecordsFromTurns(adapter.collectTurnCandidates(), 'local-session');
    const engine = new VirtualizationEngine({
      config: DEFAULT_CONFIG,
      snapshotStore: new IndexedDbSnapshotStore('ecv-virtualizer-layout-test')
    });

    try {
      await engine.attach(scrollContainer, records);
      await engine.applyInitialWindow();

      expect(rectSpy).not.toHaveBeenCalled();
    } finally {
      rectSpy.mockRestore();
    }
  });

  test('releases detached roots after a short retention ttl once lightweight snapshots are ready', async () => {
    vi.useFakeTimers();
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const assistantTurn = document.querySelector<HTMLElement>('[data-turn-id="turn-2"]');
    if (!assistantTurn) {
      throw new Error('expected the oldest assistant turn');
    }

    assistantTurn.append(
      createHeavyAction('copy-turn-action-button', 'Copy'),
      createHeavyAction('good-response-turn-action-button', 'Good'),
      createHeavyAction('bad-response-turn-action-button', 'Bad'),
      createCitationPill()
    );

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();
    if (!scrollContainer) {
      throw new Error('expected fixture to expose a scroll container');
    }

    const snapshotStore = new MemorySnapshotStore();
    const records = buildQaRecordsFromTurns(adapter.collectTurnCandidates(), 'local-session');
    const engine = new VirtualizationEngine({
      config: DEFAULT_CONFIG,
      snapshotStore,
      detachedRootRetentionMs: 50,
      snapshotSerializeDelayMs: 10
    });

    try {
      await engine.attach(scrollContainer, records);
      await engine.applyInitialWindow();

      const oldestRecord = records[0];
      if (!oldestRecord) {
        throw new Error('expected the oldest record');
      }

      expect(oldestRecord.detachedRoot).not.toBeNull();
      expect(oldestRecord.snapshotHtml).toBeUndefined();

      await vi.advanceTimersByTimeAsync(10);

      expect(oldestRecord.snapshotHtml).toBeDefined();
      expect(await snapshotStore.getSnapshot('local-session', oldestRecord.id)).toBeDefined();
      expect(oldestRecord.detachedRoot).not.toBeNull();

      await vi.advanceTimersByTimeAsync(40);

      expect(oldestRecord.detachedRoot).toBeNull();
    } finally {
      engine.dispose();
      vi.useRealTimers();
    }
  });

  test('restores released records from lightweight snapshots without heavy action chrome', async () => {
    vi.useFakeTimers();
    installFixtureDom('chatgpt-long.html', 'https://chatgpt.com/c/local-session');

    const assistantTurn = document.querySelector<HTMLElement>('[data-turn-id="turn-2"]');
    if (!assistantTurn) {
      throw new Error('expected the oldest assistant turn');
    }

    assistantTurn.append(
      createHeavyAction('copy-turn-action-button', 'Copy'),
      createHeavyAction('good-response-turn-action-button', 'Good'),
      createHeavyAction('bad-response-turn-action-button', 'Bad'),
      createCitationPill()
    );

    const adapter = new ChatGptPageAdapter(document);
    const scrollContainer = adapter.getScrollContainer();
    if (!scrollContainer) {
      throw new Error('expected fixture to expose a scroll container');
    }

    const snapshotStore = new MemorySnapshotStore();
    const records = buildQaRecordsFromTurns(adapter.collectTurnCandidates(), 'local-session');
    const engine = new VirtualizationEngine({
      config: DEFAULT_CONFIG,
      snapshotStore,
      detachedRootRetentionMs: 20,
      snapshotSerializeDelayMs: 5
    });

    try {
      await engine.attach(scrollContainer, records);
      await engine.applyInitialWindow();
      await vi.advanceTimersByTimeAsync(20);

      const oldestRecord = records[0];
      if (!oldestRecord) {
        throw new Error('expected the oldest record');
      }

      expect(oldestRecord.detachedRoot).toBeNull();

      await engine.restoreRange(0, 0);

      const restoredRoot = scrollContainer.querySelector<HTMLElement>('[data-record-id="local-session:record:0"]');
      expect(restoredRoot).not.toBeNull();
      expect(restoredRoot?.textContent).toContain('Question 1');
      expect(restoredRoot?.textContent).toContain('Answer 1');
      expect(restoredRoot?.querySelector('[data-testid="copy-turn-action-button"]')).toBeNull();
      expect(restoredRoot?.querySelector('[data-testid="good-response-turn-action-button"]')).toBeNull();
      expect(restoredRoot?.querySelector('[data-testid="bad-response-turn-action-button"]')).toBeNull();
      expect(restoredRoot?.querySelector('[data-testid="webpage-citation-pill"]')).toBeNull();
    } finally {
      engine.dispose();
      vi.useRealTimers();
    }
  });
});

class SlowSnapshotStore implements SnapshotStore {
  private readonly resolvers: Array<() => void> = [];
  private readonly snapshots = new Map<string, RecordSnapshot>();

  async putSnapshot(snapshot: RecordSnapshot): Promise<void> {
    this.snapshots.set(this.key(snapshot.sessionId, snapshot.recordId), snapshot);
    await new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  async getSnapshot(sessionId: string, recordId: string): Promise<RecordSnapshot | undefined> {
    return this.snapshots.get(this.key(sessionId, recordId));
  }

  async getSnapshotsForSession(sessionId: string): Promise<RecordSnapshot[]> {
    return Array.from(this.snapshots.values()).filter((snapshot) => snapshot.sessionId === sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    for (const key of Array.from(this.snapshots.keys())) {
      if (key.startsWith(`${sessionId}::`)) {
        this.snapshots.delete(key);
      }
    }
  }

  async pruneSessions(): Promise<void> {}

  async clear(): Promise<void> {
    this.snapshots.clear();
  }

  flush(): void {
    for (const resolve of this.resolvers.splice(0)) {
      resolve();
    }
  }

  private key(sessionId: string, recordId: string): string {
    return `${sessionId}::${recordId}`;
  }
}

class MemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, RecordSnapshot>();

  async putSnapshot(snapshot: RecordSnapshot): Promise<void> {
    this.snapshots.set(this.key(snapshot.sessionId, snapshot.recordId), snapshot);
  }

  async getSnapshot(sessionId: string, recordId: string): Promise<RecordSnapshot | undefined> {
    return this.snapshots.get(this.key(sessionId, recordId));
  }

  async getSnapshotsForSession(sessionId: string): Promise<RecordSnapshot[]> {
    return Array.from(this.snapshots.values()).filter((snapshot) => snapshot.sessionId === sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    for (const key of Array.from(this.snapshots.keys())) {
      if (key.startsWith(`${sessionId}::`)) {
        this.snapshots.delete(key);
      }
    }
  }

  async pruneSessions(): Promise<void> {}

  async clear(): Promise<void> {
    this.snapshots.clear();
  }

  private key(sessionId: string, recordId: string): string {
    return `${sessionId}::${recordId}`;
  }
}

function createHeavyAction(testId: string, text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.setAttribute('data-testid', testId);
  button.textContent = text;
  return button;
}

function createCitationPill(): HTMLSpanElement {
  const pill = document.createElement('span');
  pill.setAttribute('data-testid', 'webpage-citation-pill');
  pill.textContent = 'Citation';
  return pill;
}
