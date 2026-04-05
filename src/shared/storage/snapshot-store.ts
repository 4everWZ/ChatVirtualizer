import type { RecordSnapshot, SnapshotStore } from '@/shared/contracts';

interface SessionMeta {
  lastAccessed: number;
  sessionId: string;
}

const SNAPSHOT_STORE = 'snapshots';
const SESSION_STORE = 'sessions';
const SESSION_INDEX = 'by-session';

export class IndexedDbSnapshotStore implements SnapshotStore {
  private databasePromise?: Promise<IDBDatabase>;

  constructor(private readonly databaseName = 'edge-chat-virtualizer') {}

  async putSnapshot(snapshot: RecordSnapshot): Promise<void> {
    const database = await this.open();
    await this.runTransaction(database, 'readwrite', (transaction) => {
      transaction.objectStore(SNAPSHOT_STORE).put(snapshot);
      transaction.objectStore(SESSION_STORE).put({
        sessionId: snapshot.sessionId,
        lastAccessed: snapshot.updatedAt
      } satisfies SessionMeta);
    });
  }

  async getSnapshot(sessionId: string, recordId: string): Promise<RecordSnapshot | undefined> {
    const database = await this.open();
    const record = await this.request<RecordSnapshot | undefined>(
      database.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).get([sessionId, recordId])
    );

    if (record) {
      await this.touchSession(sessionId, record.updatedAt);
    }

    return record;
  }

  async getSnapshotsForSession(sessionId: string): Promise<RecordSnapshot[]> {
    const database = await this.open();
    const index = database.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).index(SESSION_INDEX);
    return this.request<RecordSnapshot[]>(index.getAll(IDBKeyRange.only(sessionId)));
  }

  async deleteSession(sessionId: string): Promise<void> {
    const database = await this.open();
    const snapshots = await this.getSnapshotsForSession(sessionId);

    await this.runTransaction(database, 'readwrite', (transaction) => {
      const snapshotStore = transaction.objectStore(SNAPSHOT_STORE);
      for (const snapshot of snapshots) {
        snapshotStore.delete([snapshot.sessionId, snapshot.recordId]);
      }

      transaction.objectStore(SESSION_STORE).delete(sessionId);
    });
  }

  async pruneSessions(maxSessions: number): Promise<void> {
    const database = await this.open();
    const sessions = await this.request<SessionMeta[]>(
      database.transaction(SESSION_STORE, 'readonly').objectStore(SESSION_STORE).getAll()
    );

    const stale = sessions
      .sort((left, right) => right.lastAccessed - left.lastAccessed)
      .slice(maxSessions);

    for (const session of stale) {
      await this.deleteSession(session.sessionId);
    }
  }

  async clear(): Promise<void> {
    const database = await this.open();
    await this.runTransaction(database, 'readwrite', (transaction) => {
      transaction.objectStore(SNAPSHOT_STORE).clear();
      transaction.objectStore(SESSION_STORE).clear();
    });
  }

  private async open(): Promise<IDBDatabase> {
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.databaseName, 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          const database = request.result;

          if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
            const snapshotStore = database.createObjectStore(SNAPSHOT_STORE, {
              keyPath: ['sessionId', 'recordId']
            });
            snapshotStore.createIndex(SESSION_INDEX, 'sessionId', { unique: false });
          }

          if (!database.objectStoreNames.contains(SESSION_STORE)) {
            database.createObjectStore(SESSION_STORE, {
              keyPath: 'sessionId'
            });
          }
        };
        request.onsuccess = () => resolve(request.result);
      });
    }

    return this.databasePromise;
  }

  private async runTransaction(
    database: IDBDatabase,
    mode: IDBTransactionMode,
    callback: (transaction: IDBTransaction) => void
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([SNAPSHOT_STORE, SESSION_STORE], mode);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();
      callback(transaction);
    });
  }

  private async request<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  private async touchSession(sessionId: string, timestamp: number): Promise<void> {
    const database = await this.open();
    await this.runTransaction(database, 'readwrite', (transaction) => {
      transaction.objectStore(SESSION_STORE).put({
        sessionId,
        lastAccessed: timestamp
      } satisfies SessionMeta);
    });
  }
}
