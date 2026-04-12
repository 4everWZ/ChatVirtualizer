import { CHATGPT_TURN_SELECTORS, ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { buildQaRecordsFromTurns } from '@/content/records/record-engine';
import { ScrollManager } from '@/content/scroll/scroll-manager';
import { VirtualizationEngine } from '@/content/virtualization/virtualization-engine';
import { getTopRestoreRange } from '@/content/virtualization/window-manager';
import { DEFAULT_CONFIG, mergeConfig } from '@/shared/config';
import { createRecordId } from '@/shared/ids';
import type { ExtensionConfig, PageAdapter, QARecord, SessionState } from '@/shared/contracts';
import { Logger } from '@/shared/logger';
import type { RuntimeMessage } from '@/shared/runtime-messages';
import { ConfigStore } from '@/shared/storage/config-store';
import { IndexedDbSnapshotStore } from '@/shared/storage/snapshot-store';

interface SessionControllerOptions {
  adapter?: PageAdapter;
  configStore?: ConfigStore;
  snapshotStore?: IndexedDbSnapshotStore;
}

const INITIAL_ACTIVATION_QUIET_MS = 250;

export class SessionController {
  private readonly adapter: PageAdapter;
  private readonly configStore: ConfigStore;
  private readonly snapshotStore: IndexedDbSnapshotStore;

  private config: ExtensionConfig = DEFAULT_CONFIG;
  private logger = new Logger(false);
  private mutationObserver?: MutationObserver;
  private activationObserver?: MutationObserver;
  private activationCheckQueued = false;
  private scrollManager?: ScrollManager;
  private cleanupSessionObserver?: () => void;
  private currentSessionState?: SessionState;
  private records: QARecord[] = [];
  private scrollContainer: HTMLElement | null = null;
  private isApplyingDomChanges = false;
  private initializationTimer?: number;
  private cleanupQuickJumpListener?: () => void;
  private cleanupScrollModeListener?: () => void;
  private reindexTimer?: number;
  private phaseSettleTimer?: number;
  private virtualizer?: VirtualizationEngine;

  constructor(options: SessionControllerOptions = {}) {
    this.adapter = options.adapter ?? new ChatGptPageAdapter(document);
    this.configStore = options.configStore ?? new ConfigStore();
    this.snapshotStore = options.snapshotStore ?? new IndexedDbSnapshotStore();
  }

  async start(): Promise<void> {
    this.config = mergeConfig(await this.configStore.getConfig());
    this.logger = new Logger(this.config.debugLogging);

    globalThis.chrome?.runtime?.onMessage.addListener(this.handleRuntimeMessage);

    this.cleanupSessionObserver = this.adapter.observeSessionChanges(() => {
      void this.ensureSessionStarted();
    });

    await this.ensureSessionStarted();
  }

  stop(): void {
    globalThis.chrome?.runtime?.onMessage.removeListener(this.handleRuntimeMessage);
    void this.virtualizer?.persistCollapsedSnapshots();
    this.virtualizer?.dispose();
    this.cleanupSessionObserver?.();
    this.cleanupSessionObserver = undefined;
    this.activationObserver?.disconnect();
    this.activationObserver = undefined;
    this.activationCheckQueued = false;
    this.scrollManager?.disconnect();
    this.scrollManager = undefined;
    this.cleanupQuickJumpListener?.();
    this.cleanupQuickJumpListener = undefined;
    this.cleanupScrollModeListener?.();
    this.cleanupScrollModeListener = undefined;
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;

    if (this.reindexTimer !== undefined) {
      clearTimeout(this.reindexTimer);
      this.reindexTimer = undefined;
    }

    this.clearPhaseSettleTimer();

    if (this.initializationTimer !== undefined) {
      clearTimeout(this.initializationTimer);
      this.initializationTimer = undefined;
    }
  }

  getStats() {
    const isConversationPath = globalThis.location.pathname.includes('/c/');

    return {
      adapterConfidence: this.adapter.canHandlePage() ? this.adapter.getConfidence() : 0,
      collapsedGroupCount: this.virtualizer?.getCollapsedGroupCount() ?? 0,
      mountedCount: this.records.filter((record) => record.mounted).length,
      sessionId: this.currentSessionState?.sessionId ?? (isConversationPath ? this.adapter.getSessionId() : 'No active conversation'),
      totalRecords: this.records.length
    };
  }

  private async ensureSessionStarted(): Promise<void> {
    if (!this.adapter.canHandlePage()) {
      this.clearInitializationTimer();
      this.resetSessionState();
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

    if (this.currentSessionState?.sessionId === this.adapter.getSessionId()) {
      this.disarmActivationWatcher();
      return;
    }

    this.armActivationWatcher();
    this.scheduleInitialization(INITIAL_ACTIVATION_QUIET_MS);
  }

  private async initializeSession(): Promise<void> {
    const sessionId = this.adapter.getSessionId();
    const scrollContainer = this.adapter.getScrollContainer();
    if (!scrollContainer) {
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

    this.scrollContainer = scrollContainer;
    const turns = this.adapter.collectTurnCandidates();
    if (turns.length === 0) {
      this.resetSessionState();
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

    this.records = buildQaRecordsFromTurns(turns, sessionId);

    const phase =
      this.currentSessionState?.sessionId === sessionId
        ? this.currentSessionState.phase
        : 'bootstrapping';

    await this.applySessionRecords(sessionId, scrollContainer, this.records, this.currentSessionState?.windowMode ?? 'auto', phase);
  }

  private armActivationWatcher(): void {
    if (!document.body) {
      return;
    }

    if (!this.activationObserver) {
      this.activationObserver = new MutationObserver(() => {
        this.queueActivationCheck();
      });
      this.activationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
    }
  }

  private disarmActivationWatcher(): void {
    this.activationObserver?.disconnect();
    this.activationObserver = undefined;
    this.activationCheckQueued = false;
  }

  private resetSessionState(): void {
    this.clearInitializationTimer();
    this.clearPhaseSettleTimer();
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.scrollManager?.disconnect();
    this.scrollManager = undefined;
    this.cleanupQuickJumpListener?.();
    this.cleanupQuickJumpListener = undefined;
    this.cleanupScrollModeListener?.();
    this.cleanupScrollModeListener = undefined;
    void this.virtualizer?.persistCollapsedSnapshots();
    this.virtualizer?.dispose();
    this.virtualizer = undefined;
    this.currentSessionState = undefined;
    this.records = [];
    this.scrollContainer = null;
  }

  private queueActivationCheck(): void {
    if (this.activationCheckQueued) {
      return;
    }

    this.activationCheckQueued = true;
    queueMicrotask(() => {
      this.activationCheckQueued = false;
      void this.ensureSessionStarted();
    });
  }

  private scheduleInitialization(quietMs: number): void {
    this.clearInitializationTimer();
    this.initializationTimer = window.setTimeout(() => {
      this.initializationTimer = undefined;
      this.disarmActivationWatcher();
      void this.initializeSession();
    }, quietMs);
  }

  private clearInitializationTimer(): void {
    if (this.initializationTimer === undefined) {
      return;
    }

    clearTimeout(this.initializationTimer);
    this.initializationTimer = undefined;
  }

  private observeMutations(): void {
    this.mutationObserver?.disconnect();
    if (!this.scrollContainer) {
      return;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      if (this.isApplyingDomChanges) {
        return;
      }

      if (!mutations.some((mutation) => isRelevantTurnMutation(mutation))) {
        return;
      }

      if (this.reindexTimer !== undefined) {
        clearTimeout(this.reindexTimer);
      }

      const quietMs = this.currentSessionState?.phase === 'bootstrapping' ? INITIAL_ACTIVATION_QUIET_MS : this.config.stabilityQuietMs;
      this.reindexTimer = window.setTimeout(() => {
        this.reindexTimer = undefined;
        void this.reindexSession();
      }, quietMs);

      if (this.currentSessionState?.phase === 'bootstrapping') {
        this.armSteadyPhaseTimer();
      }
    });

    this.mutationObserver.observe(this.scrollContainer, {
      attributeFilter: ['aria-busy', 'data-generating'],
      attributes: true,
      childList: true,
      subtree: true
    });
  }

  private async restorePreviousBatch(): Promise<void> {
    if (!this.currentSessionState || !this.scrollContainer || !this.virtualizer) {
      return;
    }

    const range = getTopRestoreRange(this.currentSessionState, this.config);
    if (!range) {
      return;
    }

    const before = this.scrollContainer.scrollHeight;
    await this.runWithoutMutationReindex(async () => {
      await this.virtualizer?.restoreRange(range.start, range.end);
      this.records = this.virtualizer?.getRecords() ?? this.records;
    });
    const after = this.scrollContainer.scrollHeight;
    this.scrollContainer.scrollTop += after - before;
    this.setWindowMode('manual-expanded');
    this.syncSessionState();
    await this.publishStats();
  }

  private async reindexSession(): Promise<void> {
    const sessionId = this.adapter.getSessionId();
    const scrollContainer = this.adapter.getScrollContainer();
    if (!this.currentSessionState || !this.virtualizer || this.currentSessionState.sessionId !== sessionId || !scrollContainer) {
      await this.initializeSession();
      return;
    }

    const partialTurns = this.adapter.collectTurnCandidates();
    if (partialTurns.length === 0) {
      return;
    }

    const partialRecords = buildQaRecordsFromTurns(partialTurns, sessionId);
    const mergedRecords = this.mergeVisibleRecords(sessionId, partialRecords);

    if (!mergedRecords) {
      await this.initializeSession();
      return;
    }

    await this.applySessionRecords(sessionId, scrollContainer, mergedRecords, this.currentSessionState.windowMode, this.currentSessionState.phase);
  }

  private async runWithoutMutationReindex(work: () => Promise<void>): Promise<void> {
    this.mutationObserver?.disconnect();
    this.isApplyingDomChanges = true;

    try {
      await work();
    } finally {
      this.isApplyingDomChanges = false;
      if (this.scrollContainer) {
        this.observeMutations();
      }
    }
  }

  private async applySessionRecords(
    sessionId: string,
    scrollContainer: HTMLElement,
    records: QARecord[],
    windowMode: SessionState['windowMode'],
    phase: SessionState['phase']
  ): Promise<void> {
    this.scrollContainer = scrollContainer;
    this.records = records;
    if (this.virtualizer) {
      void this.virtualizer.persistCollapsedSnapshots();
      this.virtualizer.dispose();
    }
    this.virtualizer = new VirtualizationEngine({
      config: this.config,
      logger: this.logger,
      snapshotStore: this.snapshotStore
    });

    await this.runWithoutMutationReindex(async () => {
      await this.virtualizer?.attach(scrollContainer, this.records);
      if (this.config.enableVirtualization && windowMode === 'auto') {
        await this.virtualizer?.applyInitialWindow();
      } else {
        this.virtualizer?.refreshCollapsedGroups();
      }
      this.records = this.virtualizer?.getRecords() ?? this.records;
    });

    this.currentSessionState = {
      sessionId,
      recordIdsInOrder: [],
      activeWindowStart: 0,
      activeWindowEnd: 0,
      totalRecords: this.records.length,
      fullyIndexed: true,
      windowMode,
      phase
    };
    this.syncSessionState();
    if (phase === 'bootstrapping') {
      if (this.phaseSettleTimer === undefined) {
        this.armSteadyPhaseTimer();
      }
    } else {
      this.clearPhaseSettleTimer();
    }

    this.scrollManager?.disconnect();
    this.scrollManager = new ScrollManager(scrollContainer, {
      topThresholdPx: this.config.topThresholdPx,
      onReachTop: () => this.restorePreviousBatch()
    });

    this.installScrollModeListener(scrollContainer);
    this.installQuickJumpListener();
    this.observeMutations();
    await this.publishStats();
  }

  private mergeVisibleRecords(sessionId: string, partialRecords: QARecord[]): QARecord[] | null {
    if (this.records.length === 0) {
      return partialRecords;
    }

    const overlap = findSuffixPrefixOverlap(this.records, partialRecords);
    if (overlap < 0) {
      return null;
    }

    const merged = [...this.records];
    const overlapStart = this.records.length - overlap;

    for (let index = 0; index < overlap; index += 1) {
      const targetIndex = overlapStart + index;
      const existing = this.records[targetIndex]!;
      const partial = partialRecords[index]!;
      merged[targetIndex] = {
        ...partial,
        id: existing.id,
        index: existing.index,
        sessionId,
        mounted: existing.mounted,
        renderMode: existing.renderMode,
        protectedUntil: existing.protectedUntil,
        rootElement: null,
        detachedRoot: existing.detachedRoot,
        liveRootCache: existing.liveRootCache,
        snapshotHtml: existing.snapshotHtml
      };
    }

    for (let index = overlap; index < partialRecords.length; index += 1) {
      const partial = partialRecords[index]!;
      const recordIndex = merged.length;
      merged.push({
        ...partial,
        id: createRecordId(sessionId, recordIndex),
        index: recordIndex,
        sessionId,
        rootElement: null,
        detachedRoot: undefined,
        liveRootCache: undefined
      });
    }

    return merged;
  }

  private installScrollModeListener(scrollContainer: HTMLElement): void {
    this.cleanupScrollModeListener?.();

    const onScroll = () => {
      if (this.currentSessionState?.windowMode !== 'manual-expanded') {
        return;
      }

      const distanceFromBottom = scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
      if (distanceFromBottom > this.config.preloadBufferPx) {
        return;
      }

      void this.restoreAutoWindowMode();
    };

    scrollContainer.addEventListener('scroll', onScroll, {
      passive: true
    });

    this.cleanupScrollModeListener = () => {
      scrollContainer.removeEventListener('scroll', onScroll);
    };
  }

  private installQuickJumpListener(): void {
    this.cleanupQuickJumpListener?.();
    this.cleanupQuickJumpListener = undefined;

    const quickJumpContainer = this.adapter.getQuickJumpContainer?.();
    if (!quickJumpContainer || !this.adapter.extractQuickJumpText) {
      return;
    }

    const onClick = (event: Event) => {
      const text = this.adapter.extractQuickJumpText?.(event.target);
      if (!text) {
        return;
      }

      const match = this.findQuickJumpMatch(text);
      if (!match || match.mounted) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void this.restoreRecordContext(match.recordId);
    };

    quickJumpContainer.addEventListener('click', onClick, true);
    this.cleanupQuickJumpListener = () => {
      quickJumpContainer.removeEventListener('click', onClick, true);
    };
  }

  private findQuickJumpMatch(rawText: string): { recordId: string; mounted: boolean } | null {
    const query = normalizeQuickJumpText(rawText);
    if (query.length < 4) {
      return null;
    }

    const matches = this.records
      .map((record) => ({
        mounted: record.mounted,
        recordId: record.id,
        score: scoreQuickJumpMatch(record, query)
      }))
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score);

    if (matches.length === 0) {
      return null;
    }

    const [best, second] = matches;
    if (!best) {
      return null;
    }

    if (best.mounted) {
      return {
        recordId: best.recordId,
        mounted: true
      };
    }

    if (best.score < 2 || (second && second.score === best.score)) {
      return null;
    }

    return {
      recordId: best.recordId,
      mounted: false
    };
  }

  private async restoreRecordContext(recordId: string): Promise<void> {
    if (!this.currentSessionState || !this.scrollContainer || !this.virtualizer) {
      return;
    }

    const targetIndex = this.records.findIndex((record) => record.id === recordId);
    if (targetIndex < 0 || this.records[targetIndex]?.mounted) {
      return;
    }

    const start = Math.max(0, targetIndex - this.config.searchContextBefore);
    const end = Math.min(this.records.length - 1, targetIndex + this.config.searchContextAfter);
    this.virtualizer?.clearForcedLiveRecordIds();

    await this.runWithoutMutationReindex(async () => {
      await this.virtualizer?.restoreRange(start, end, {
        forceLiveRecordIds: this.records.slice(start, end + 1).map((record) => record.id)
      });
      this.records = this.virtualizer?.getRecords() ?? this.records;
    });

    this.setWindowMode('manual-expanded');
    this.syncSessionState();
    this.virtualizer.scrollToRecord(recordId);
    await this.publishStats();
  }

  private async restoreAutoWindowMode(): Promise<void> {
    if (!this.currentSessionState || !this.virtualizer || !this.scrollContainer) {
      return;
    }

    if (this.currentSessionState.windowMode !== 'manual-expanded') {
      return;
    }

    this.setWindowMode('auto');
    this.virtualizer.clearForcedLiveRecordIds();
    await this.runWithoutMutationReindex(async () => {
      await this.virtualizer?.applyWindowPlan();
      this.records = this.virtualizer?.getRecords() ?? this.records;
    });
    this.syncSessionState();
    this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
    await this.publishStats();
  }

  private setWindowMode(windowMode: SessionState['windowMode']): void {
    if (!this.currentSessionState) {
      return;
    }

    this.currentSessionState.windowMode = windowMode;
  }

  private armSteadyPhaseTimer(): void {
    this.clearPhaseSettleTimer();
    if (!this.currentSessionState || this.currentSessionState.phase !== 'bootstrapping') {
      return;
    }

    this.phaseSettleTimer = window.setTimeout(() => {
      this.phaseSettleTimer = undefined;
      if (!this.currentSessionState || this.currentSessionState.phase !== 'bootstrapping') {
        return;
      }

      this.currentSessionState.phase = 'steady';
    }, this.config.stabilityQuietMs);
  }

  private clearPhaseSettleTimer(): void {
    if (this.phaseSettleTimer === undefined) {
      return;
    }

    clearTimeout(this.phaseSettleTimer);
    this.phaseSettleTimer = undefined;
  }

  private syncSessionState(): void {
    if (!this.currentSessionState) {
      return;
    }

    const mountedIndices = this.records.flatMap((record, index) => (record.mounted ? [index] : []));
    this.currentSessionState.recordIdsInOrder = this.records.map((record) => record.id);
    this.currentSessionState.activeWindowStart = mountedIndices[0] ?? 0;
    this.currentSessionState.activeWindowEnd = mountedIndices.at(-1) ?? Math.max(this.records.length - 1, 0);
    this.currentSessionState.totalRecords = this.records.length;
  }

  private readonly handleRuntimeMessage = (
    message: RuntimeMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return false;
    }

    void (async () => {
      switch (message.type) {
        case 'get-active-session-stats':
          sendResponse(this.getStats());
          break;
        default:
          sendResponse(undefined);
      }
    })();

    return true;
  };

  private async publishStats(): Promise<void> {
    try {
      await globalThis.chrome?.runtime?.sendMessage({
        type: 'session-stats',
        payload: this.getStats()
      });
    } catch {
      // Ignore when no background worker is connected.
    }
  }
}

function normalizeQuickJumpText(value: string): string {
  return value.replace(/[.…]+$/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function scoreQuickJumpMatch(record: QARecord, query: string): number {
  const normalizedUser = normalizeQuickJumpRecordText(record.textUser);
  const normalizedCombined = normalizeQuickJumpRecordText(record.textCombined);

  if (normalizedUser === query) {
    return 6;
  }

  if (normalizedCombined === query) {
    return 5;
  }

  if (normalizedUser.startsWith(query)) {
    return 4;
  }

  if (normalizedUser.includes(query)) {
    return 3;
  }

  if (normalizedCombined.startsWith(query)) {
    return 2;
  }

  if (normalizedCombined.includes(query)) {
    return 1;
  }

  return 0;
}

function recordsAreCompatible(left: QARecord, right: QARecord): boolean {
  return normalizeQuickJumpRecordText(left.textUser) === normalizeQuickJumpRecordText(right.textUser);
}

function findSuffixPrefixOverlap(existingRecords: QARecord[], partialRecords: QARecord[]): number {
  const maxOverlap = Math.min(existingRecords.length, partialRecords.length);

  for (let overlap = maxOverlap; overlap >= 0; overlap -= 1) {
    let matches = true;

    for (let index = 0; index < overlap; index += 1) {
      const left = existingRecords[existingRecords.length - overlap + index];
      const right = partialRecords[index];
      if (!left || !right || !recordsAreCompatible(left, right)) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return overlap;
    }
  }

  return -1;
}

function normalizeQuickJumpRecordText(value: string): string {
  return normalizeQuickJumpText(value).replace(/^(you said:|chatgpt said:|assistant:|user:)\s*/i, '');
}

function isRelevantTurnMutation(mutation: MutationRecord): boolean {
  if (mutation.type === 'attributes') {
    return hasRelevantTurnTarget(mutation.target);
  }

  return hasRelevantTurnTarget(mutation.target) || hasRelevantTurnNode(mutation.addedNodes) || hasRelevantTurnNode(mutation.removedNodes);
}

function hasRelevantTurnNode(nodes: NodeList): boolean {
  return Array.from(nodes).some((node) => {
    return hasRelevantTurnTarget(node);
  });
}

function hasRelevantTurnTarget(node: Node | null): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  return node.matches(CHATGPT_TURN_SELECTORS) || node.closest(CHATGPT_TURN_SELECTORS) !== null || node.querySelector(CHATGPT_TURN_SELECTORS) !== null;
}
