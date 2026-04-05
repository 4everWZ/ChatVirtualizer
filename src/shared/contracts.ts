export type TurnRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ExtensionConfig {
  windowSizeQa: number;
  loadBatchQa: number;
  topThresholdPx: number;
  preloadBufferPx: number;
  searchContextBefore: number;
  searchContextAfter: number;
  protectGenerating: boolean;
  enableVirtualization: boolean;
  debugLogging: boolean;
  maxPersistedSessions: number;
  stabilityQuietMs: number;
}

export interface QARecord {
  id: string;
  index: number;
  sessionId: string;
  userTurnIds: string[];
  assistantTurnIds: string[];
  textUser: string;
  textAssistant: string;
  textCombined: string;
  height: number;
  mounted: boolean;
  stable: boolean;
  generating: boolean;
  protectedUntil?: number;
  snapshotHtml?: string;
  anchorSignature?: string;
  elements?: HTMLElement[];
  rootElement?: HTMLElement | null;
}

export interface SessionState {
  sessionId: string;
  recordIdsInOrder: string[];
  activeWindowStart: number;
  activeWindowEnd: number;
  totalRecords: number;
  fullyIndexed: boolean;
}

export interface SearchHit {
  recordId: string;
  score: number;
  matchedIn: 'user' | 'assistant' | 'code' | 'combined';
  snippet: string;
}

export interface RecordSnapshot {
  sessionId: string;
  recordId: string;
  html: string;
  textCombined: string;
  height: number;
  anchorSignature: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStats {
  sessionId: string;
  totalRecords: number;
  mountedCount: number;
  collapsedGroupCount: number;
  adapterConfidence: number;
}

export interface WindowPlan {
  mountRecordIds: string[];
  evictRecordIds: string[];
}

export interface RestoreRange {
  start: number;
  end: number;
}

export interface TurnCandidate {
  id: string;
  role: TurnRole;
  text: string;
  element: HTMLElement;
  generating?: boolean;
}

export interface PageAdapter {
  canHandlePage(): boolean;
  getSessionId(): string;
  getScrollContainer(): HTMLElement | null;
  collectTurnCandidates(): TurnCandidate[];
  observeSessionChanges(callback: () => void): () => void;
  getConfidence(): number;
}

export interface SnapshotStore {
  putSnapshot(snapshot: RecordSnapshot): Promise<void>;
  getSnapshot(sessionId: string, recordId: string): Promise<RecordSnapshot | undefined>;
  getSnapshotsForSession(sessionId: string): Promise<RecordSnapshot[]>;
  deleteSession(sessionId: string): Promise<void>;
  pruneSessions(maxSessions: number): Promise<void>;
  clear(): Promise<void>;
}
