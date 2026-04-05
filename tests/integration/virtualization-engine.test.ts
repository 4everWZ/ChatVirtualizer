import { ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { buildQaRecordsFromTurns } from '@/content/records/record-engine';
import type { RecordSnapshot, SnapshotStore } from '@/shared/contracts';
import { VirtualizationEngine } from '@/content/virtualization/virtualization-engine';
import { DEFAULT_CONFIG } from '@/shared/config';
import { IndexedDbSnapshotStore } from '@/shared/storage/snapshot-store';
import { vi } from 'vitest';
import { installFixtureDom } from '../helpers/fixture-dom';

describe('virtualization engine', () => {
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
