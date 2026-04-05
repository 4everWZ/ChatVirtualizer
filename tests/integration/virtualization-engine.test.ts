import { ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { buildQaRecordsFromTurns } from '@/content/records/record-engine';
import { VirtualizationEngine } from '@/content/virtualization/virtualization-engine';
import { DEFAULT_CONFIG } from '@/shared/config';
import { IndexedDbSnapshotStore } from '@/shared/storage/snapshot-store';
import { installFixtureDom } from '../helpers/fixture-dom';

describe('virtualization engine', () => {
  test('compresses older records into placeholders and restores them by range', async () => {
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

    expect(scrollContainer.querySelectorAll('.ecv-placeholder')).toHaveLength(2);
    expect(engine.getMountedCount()).toBe(10);

    await engine.restoreRange(0, 1);

    expect(scrollContainer.querySelectorAll('.ecv-placeholder')).toHaveLength(0);
    expect(engine.getMountedCount()).toBe(12);
  });
});
