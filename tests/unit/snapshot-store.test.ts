import { IndexedDbSnapshotStore } from '@/shared/storage/snapshot-store';

describe('snapshot store', () => {
  test('prunes older sessions by lru order', async () => {
    const store = new IndexedDbSnapshotStore('edge-chat-virtualizer-test');

    await store.putSnapshot({
      sessionId: 'session-1',
      recordId: 'record-1',
      html: '<article>One</article>',
      textCombined: 'One',
      height: 120,
      anchorSignature: 'one',
      createdAt: 1,
      updatedAt: 1
    });

    await store.putSnapshot({
      sessionId: 'session-2',
      recordId: 'record-2',
      html: '<article>Two</article>',
      textCombined: 'Two',
      height: 120,
      anchorSignature: 'two',
      createdAt: 2,
      updatedAt: 2
    });

    await store.pruneSessions(1);

    await expect(store.getSnapshot('session-1', 'record-1')).resolves.toBeUndefined();
    await expect(store.getSnapshot('session-2', 'record-2')).resolves.toBeDefined();
  });
});
