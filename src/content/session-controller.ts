import { CHATGPT_TURN_SELECTORS, ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { buildQaRecordsFromTurns } from '@/content/records/record-engine';
import { ScrollManager } from '@/content/scroll/scroll-manager';
import { VirtualizationEngine } from '@/content/virtualization/virtualization-engine';
import { computeWindowPlan, getTopRestoreRange } from '@/content/virtualization/window-manager';
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
const MIN_TAIL_RECOVERY_RECORDS = 3;
type InitializationMode = 'session-init' | 'native-edit-recovery';

export class SessionController {
  private readonly adapter: PageAdapter;
  private readonly configStore: ConfigStore;
  private readonly snapshotStore: IndexedDbSnapshotStore;

  private config: ExtensionConfig = DEFAULT_CONFIG;
  private logger = new Logger(false);
  private mutationObserver?: MutationObserver;
  private activationObserver?: MutationObserver;
  private activationCheckQueued = false;
  private awaitingNativeEditTransition = false;
  private healthObserver?: MutationObserver;
  private healthCheckQueued = false;
  private scrollManager?: ScrollManager;
  private cleanupSessionObserver?: () => void;
  private currentSessionState?: SessionState;
  private records: QARecord[] = [];
  private scrollContainer: HTMLElement | null = null;
  private isApplyingDomChanges = false;
  private initializationTimer?: number;
  private initializationMode: InitializationMode = 'session-init';
  private cleanupEditModeListener?: () => void;
  private cleanupQuickJumpListener?: () => void;
  private cleanupScrollModeListener?: () => void;
  private nativeEditActive = false;
  private nativeEditAnchorRecordIndex: number | null = null;
  private nativeEditComposerSeen = false;
  private nativeEditRecoveryRecords: QARecord[] | null = null;
  private reindexTimer?: number;
  private phaseSettleTimer?: number;
  private suspendedForNativeEdit = false;
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
      void this.handleObservedSessionChange();
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
    this.awaitingNativeEditTransition = false;
    this.healthObserver?.disconnect();
    this.healthObserver = undefined;
    this.healthCheckQueued = false;
    this.scrollManager?.disconnect();
    this.scrollManager = undefined;
    this.cleanupEditModeListener?.();
    this.cleanupEditModeListener = undefined;
    this.cleanupQuickJumpListener?.();
    this.cleanupQuickJumpListener = undefined;
    this.cleanupScrollModeListener?.();
    this.cleanupScrollModeListener = undefined;
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;

    this.clearReindexTimer();

    this.clearPhaseSettleTimer();

    if (this.initializationTimer !== undefined) {
      clearTimeout(this.initializationTimer);
      this.initializationTimer = undefined;
    }

    this.nativeEditActive = false;
    this.nativeEditAnchorRecordIndex = null;
    this.nativeEditComposerSeen = false;
    this.nativeEditRecoveryRecords = null;
    this.suspendedForNativeEdit = false;
  }

  getStats() {
    const isConversationPath = globalThis.location.pathname.includes('/c/');

    return {
      adapterConfidence: this.adapter.canHandlePage() ? this.adapter.getConfidence() : 0,
      collapsedGroupCount: this.virtualizer?.getCollapsedGroupCount() ?? 0,
      mountedCount: this.records.filter((record) => record.mounted && record.rootElement?.isConnected).length,
      sessionId: this.currentSessionState?.sessionId ?? (isConversationPath ? this.adapter.getSessionId() : 'No active conversation'),
      totalRecords: this.records.length
    };
  }

  private async ensureSessionStarted(): Promise<void> {
    const nativeEditDetected = this.adapter.isNativeEditActive?.() ?? false;
    if (nativeEditDetected && !this.suspendedForNativeEdit) {
      this.enterNativeEditMode();
    }

    if (this.suspendedForNativeEdit) {
      if (nativeEditDetected) {
        this.nativeEditActive = true;
        this.nativeEditComposerSeen = true;
        this.awaitingNativeEditTransition = false;
        this.clearInitializationTimer();
        this.armActivationWatcher();
        await this.publishStats();
        return;
      }

      this.nativeEditActive = false;
      if (this.awaitingNativeEditTransition) {
        this.awaitingNativeEditTransition = false;
        this.clearInitializationTimer();
        this.armActivationWatcher();
        if (!this.nativeEditComposerSeen) {
          await this.publishStats();
          return;
        }
      }

      if (!this.adapter.canHandlePage()) {
        this.clearInitializationTimer();
        this.armActivationWatcher();
        await this.publishStats();
        return;
      }

      if ((this.nativeEditRecoveryRecords?.length ?? 0) === 0) {
        this.nativeEditActive = false;
        this.suspendedForNativeEdit = false;
        this.awaitingNativeEditTransition = false;
        this.clearInitializationTimer();
        this.armActivationWatcher();
        this.scheduleInitialization(this.config.stabilityQuietMs, 'session-init');
        await this.publishStats();
        return;
      }

      this.armActivationWatcher();
      this.scheduleInitialization(this.config.stabilityQuietMs, 'native-edit-recovery');
      return;
    }

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
    this.scheduleInitialization(INITIAL_ACTIVATION_QUIET_MS, 'session-init');
  }

  private async handleObservedSessionChange(): Promise<void> {
    const currentSessionId = this.currentSessionState?.sessionId;
    const nextSessionId = this.adapter.getSessionId();

    if (currentSessionId && currentSessionId !== nextSessionId) {
      this.releaseMountedThreadToHost();
      this.resetSessionState();
      this.armActivationWatcher();
      await this.publishStats();
    }

    await this.ensureSessionStarted();
  }

  private async initializeSession(): Promise<void> {
    if (this.adapter.isNativeEditActive?.()) {
      this.enterNativeEditMode();
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

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
        if (this.isApplyingDomChanges) {
          return;
        }

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
    this.clearReindexTimer();
    this.healthObserver?.disconnect();
    this.healthObserver = undefined;
    this.healthCheckQueued = false;
    this.awaitingNativeEditTransition = false;
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.scrollManager?.disconnect();
    this.scrollManager = undefined;
    this.cleanupEditModeListener?.();
    this.cleanupEditModeListener = undefined;
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
    this.nativeEditActive = false;
    this.nativeEditAnchorRecordIndex = null;
    this.nativeEditComposerSeen = false;
    this.nativeEditRecoveryRecords = null;
    this.suspendedForNativeEdit = false;
  }

  private releaseMountedThreadToHost(): void {
    if (!this.virtualizer) {
      return;
    }

    this.virtualizer.suspendForNativeEdit();
    this.records = this.virtualizer.getRecords();
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

  private scheduleInitialization(quietMs: number, mode: InitializationMode): void {
    this.clearInitializationTimer();
    this.initializationMode = mode;
    this.initializationTimer = window.setTimeout(() => {
      this.initializationTimer = undefined;
      this.disarmActivationWatcher();
      if (this.initializationMode === 'native-edit-recovery') {
        void this.recoverFromNativeEdit();
        return;
      }

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

  private clearReindexTimer(): void {
    if (this.reindexTimer === undefined) {
      return;
    }

    clearTimeout(this.reindexTimer);
    this.reindexTimer = undefined;
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

      if (!this.suspendedForNativeEdit && this.adapter.isNativeEditActive?.()) {
        this.enterNativeEditMode();
        return;
      }

      if (this.nativeEditActive || this.suspendedForNativeEdit) {
        this.queueActivationCheck();
        return;
      }

      if (!mutations.some((mutation) => isRelevantTurnMutation(mutation))) {
        return;
      }

      this.clearReindexTimer();

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

  private observeHostHealth(): void {
    this.healthObserver?.disconnect();
    this.healthObserver = undefined;
    this.healthCheckQueued = false;

    if (!document.body) {
      return;
    }

    this.healthObserver = new MutationObserver(() => {
      if (this.isApplyingDomChanges) {
        return;
      }

      if (this.healthCheckQueued) {
        return;
      }

      this.healthCheckQueued = true;
      queueMicrotask(() => {
        this.healthCheckQueued = false;
        void this.checkHostDomHealth();
      });
    });

    this.healthObserver.observe(document.body, {
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
      if (this.hasMountedDomLoss()) {
        this.suspendForThreadRecovery();
        await this.publishStats();
      }
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

  private async checkHostDomHealth(): Promise<void> {
    if (!this.suspendedForNativeEdit && this.adapter.isNativeEditActive?.()) {
      this.enterNativeEditMode();
      return;
    }

    if (this.nativeEditActive || this.suspendedForNativeEdit) {
      if (this.suspendedForNativeEdit) {
        this.queueActivationCheck();
      }
      return;
    }

    if (!this.currentSessionState) {
      return;
    }

    if (this.currentSessionState.sessionId !== this.adapter.getSessionId()) {
      this.releaseMountedThreadToHost();
      this.resetSessionState();
      this.armActivationWatcher();
      await this.publishStats();
      await this.ensureSessionStarted();
      return;
    }

    const mountedRecords = this.records.filter((record) => record.mounted);
    if (mountedRecords.length === 0) {
      return;
    }

    const allMountedRootsLost = mountedRecords.every((record) => !record.rootElement?.isConnected);
    const scrollContainerLost = Boolean(this.scrollContainer && !this.scrollContainer.isConnected);

    if (!allMountedRootsLost && !scrollContainerLost) {
      return;
    }

    const nextScrollContainer = this.adapter.getScrollContainer();
    const nextTurns = this.adapter.collectTurnCandidates();

    if (nextScrollContainer && nextTurns.length > 0) {
      await this.initializeSession();
      return;
    }

    this.suspendForThreadRecovery();
    await this.publishStats();
  }

  private hasMountedDomLoss(): boolean {
    const mountedRecords = this.records.filter((record) => record.mounted);
    if (mountedRecords.length === 0) {
      return false;
    }

    return mountedRecords.every((record) => !record.rootElement?.isConnected);
  }

  private suspendForThreadRecovery(): void {
    if (this.suspendedForNativeEdit) {
      return;
    }

    this.nativeEditActive = false;
    this.nativeEditComposerSeen = false;
    this.suspendedForNativeEdit = true;
    this.clearInitializationTimer();
    this.clearReindexTimer();
    this.clearPhaseSettleTimer();
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.scrollManager?.disconnect();
    this.scrollManager = undefined;
    this.cleanupEditModeListener?.();
    this.cleanupEditModeListener = undefined;
    this.cleanupQuickJumpListener?.();
    this.cleanupQuickJumpListener = undefined;
    this.cleanupScrollModeListener?.();
    this.cleanupScrollModeListener = undefined;

    if (!this.nativeEditRecoveryRecords) {
      this.nativeEditRecoveryRecords = this.records.map((record) => cloneRecoveryRecord(record));
    }

    if (this.virtualizer) {
      this.virtualizer.primeMountedSnapshots();
      this.virtualizer.suspendForNativeEdit();
      this.records = this.virtualizer.getRecords();
      this.syncSessionState();
    }

    this.armActivationWatcher();
  }

  private async recoverFromNativeEdit(): Promise<void> {
    if (this.adapter.isNativeEditActive?.()) {
      this.enterNativeEditMode();
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

    const sessionId = this.adapter.getSessionId();
    const scrollContainer = this.adapter.getScrollContainer();
    if (!scrollContainer) {
      this.logger.debug('Deferred native edit recovery because scroll container is unavailable.');
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

    const partialTurns = this.adapter.collectTurnCandidates();
    if (partialTurns.length === 0) {
      this.logger.debug('Deferred native edit recovery because no turn candidates are visible.');
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

    const partialRecords = buildQaRecordsFromTurns(partialTurns, sessionId);
    const recoveredRecords = this.recoverNativeEditRecords(sessionId, partialRecords);
    if (!recoveredRecords) {
      this.logger.debug('Deferred native edit recovery because the visible slice is not safely recoverable yet.', {
        partialRecordCount: partialRecords.length,
        preservedRecordCount: this.nativeEditRecoveryRecords?.length ?? this.records.length,
        sessionId
      });
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

    this.logger.debug('Recovered virtualization after native edit.', {
      partialRecordCount: partialRecords.length,
      sessionId
    });
    const windowMode = this.currentSessionState?.windowMode ?? 'auto';
    const phase = this.currentSessionState?.phase ?? 'steady';
    await this.applySessionRecords(sessionId, scrollContainer, recoveredRecords, windowMode, phase);
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
    this.disarmActivationWatcher();
    this.scrollContainer = scrollContainer;
    this.records = records;
    this.cleanupEditModeListener?.();
    this.cleanupEditModeListener = undefined;
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
    this.nativeEditActive = false;
    this.nativeEditRecoveryRecords = null;
    this.suspendedForNativeEdit = false;
    this.awaitingNativeEditTransition = false;
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
    this.installEditModeListener();
    this.observeMutations();
    this.observeHostHealth();
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
        mounted: partial.mounted,
        renderMode: partial.mounted ? 'live' : existing.renderMode,
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

  private recoverNativeEditRecords(sessionId: string, partialRecords: QARecord[]): QARecord[] | null {
    const preservedRecords = this.nativeEditRecoveryRecords ?? this.records;
    if (preservedRecords.length === 0) {
      return partialRecords;
    }

    const minimumRecoverableCount = Math.min(this.config.windowSizeQa, preservedRecords.length);
    const fullyRecoveredThreshold = Math.max(minimumRecoverableCount, preservedRecords.length - 1);
    const anchorIndex = this.resolveNativeEditAnchorIndex(preservedRecords);
    const recoveryRangeStarts = findContiguousRecoveryRanges(preservedRecords, partialRecords);
    const recoveryRangeStart = recoveryRangeStarts[0];
    if (recoveryRangeStarts.length === 1 && recoveryRangeStart !== undefined) {
      const recoveryRangeIncludesAnchor =
        anchorIndex !== null &&
        anchorIndex >= recoveryRangeStart &&
        anchorIndex < recoveryRangeStart + partialRecords.length;
      const mergedRecords = mergeRecoveredRecordRange(sessionId, preservedRecords, partialRecords, recoveryRangeStart);

      const canRecoverContiguousRange =
        partialRecords.length >= fullyRecoveredThreshold ||
        partialRecords.length >= minimumRecoverableCount && recoveryRangeIncludesAnchor;

      if (canRecoverContiguousRange && this.canRecoverWindowPlan(mergedRecords)) {
        return mergedRecords;
      }
    }

    const anchorGuidedStart = findAnchorGuidedRecoveryRange(preservedRecords, partialRecords, anchorIndex);
    if (anchorGuidedStart !== null) {
      const mergedRecords = mergeRecoveredRecordRange(sessionId, preservedRecords, partialRecords, anchorGuidedStart);
      if (this.canRecoverWindowPlan(mergedRecords)) {
        return mergedRecords;
      }
    }

    const anchorRebuiltRecords = this.rebuildRecordsFromNativeEditAnchor(sessionId, preservedRecords, partialRecords, anchorIndex);
    if (anchorRebuiltRecords && this.canRecoverWindowPlan(anchorRebuiltRecords)) {
      return anchorRebuiltRecords;
    }

    if (partialRecords.length >= fullyRecoveredThreshold) {
      return partialRecords;
    }

    return null;
  }

  private canRecoverWindowPlan(records: QARecord[]): boolean {
    const plan = computeWindowPlan(records, this.config, Date.now());

    return plan.mountRecordIds.every((recordId) => {
      const record = records.find((candidate) => candidate.id === recordId);
      if (!record) {
        return false;
      }

      return (
        record.mounted ||
        record.rootElement?.isConnected === true ||
        record.detachedRoot !== undefined && record.detachedRoot !== null ||
        record.liveRootCache !== undefined && record.liveRootCache !== null ||
        Boolean(record.snapshotHtml)
      );
    });
  }

  private rebuildRecordsFromNativeEditAnchor(
    sessionId: string,
    preservedRecords: QARecord[],
    partialRecords: QARecord[],
    anchorIndex: number | null
  ): QARecord[] | null {
    if (anchorIndex === null || partialRecords.length < MIN_TAIL_RECOVERY_RECORDS) {
      return null;
    }

    for (let startIndex = 0; startIndex <= anchorIndex; startIndex += 1) {
      const anchorOffset = anchorIndex - startIndex;
      if (anchorOffset <= 0 || anchorOffset >= partialRecords.length) {
        continue;
      }

      let prefixMatches = true;
      for (let offset = 0; offset < anchorOffset; offset += 1) {
        const preserved = preservedRecords[startIndex + offset];
        const partial = partialRecords[offset];
        if (!preserved || !partial || !recordsAreCompatible(preserved, partial)) {
          prefixMatches = false;
          break;
        }
      }

      if (!prefixMatches) {
        continue;
      }

      const rebuilt = preservedRecords.slice(0, anchorIndex).map((record) => cloneRecoveryRecord(record));

      for (let offset = anchorOffset; offset < partialRecords.length; offset += 1) {
        const partial = partialRecords[offset];
        if (!partial) {
          continue;
        }

        const recordIndex = rebuilt.length;
        rebuilt.push({
          ...partial,
          id: createRecordId(sessionId, recordIndex),
          index: recordIndex,
          sessionId,
          protectedUntil: undefined,
          rootElement: null,
          detachedRoot: undefined,
          liveRootCache: undefined,
          snapshotHtml: undefined
        });
      }

      return rebuilt;
    }

    return null;
  }

  private resolveNativeEditAnchorIndex(records: QARecord[] = this.nativeEditRecoveryRecords ?? this.records): number | null {
    if (this.nativeEditAnchorRecordIndex !== null) {
      return this.nativeEditAnchorRecordIndex;
    }

    const draftText = normalizeQuickJumpRecordText(this.adapter.getNativeEditDraftText?.() ?? '');
    if (!draftText) {
      return null;
    }

    const exactMatches = records
      .map((record, index) => ({ index, text: normalizeQuickJumpRecordText(record.textUser) }))
      .filter((candidate) => candidate.text === draftText);

    if (exactMatches.length !== 1) {
      return null;
    }

    this.nativeEditAnchorRecordIndex = exactMatches[0]?.index ?? null;
    return this.nativeEditAnchorRecordIndex;
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

  private installEditModeListener(): void {
    this.cleanupEditModeListener?.();
    this.cleanupEditModeListener = undefined;

    if (!this.adapter.isEditMessageTrigger) {
      return;
    }

    const onClick = (event: Event) => {
      const targetElement = resolveEventElement(event);
      if (!this.adapter.isEditMessageTrigger?.(targetElement)) {
        return;
      }

      this.enterNativeEditMode(this.findRecordIndexForTarget(targetElement));
    };

    document.addEventListener('click', onClick, true);
    this.cleanupEditModeListener = () => {
      document.removeEventListener('click', onClick, true);
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

  private enterNativeEditMode(anchorRecordIndex: number | null = this.nativeEditAnchorRecordIndex): void {
    if (this.suspendedForNativeEdit) {
      return;
    }

    this.nativeEditActive = true;
    this.nativeEditAnchorRecordIndex = anchorRecordIndex;
    this.resolveNativeEditAnchorIndex();
    this.nativeEditComposerSeen = false;
    this.suspendedForNativeEdit = true;
    this.awaitingNativeEditTransition = true;
    this.clearInitializationTimer();
    this.clearReindexTimer();
    this.clearPhaseSettleTimer();
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.scrollManager?.disconnect();
    this.scrollManager = undefined;
    this.cleanupEditModeListener?.();
    this.cleanupEditModeListener = undefined;
    this.cleanupQuickJumpListener?.();
    this.cleanupQuickJumpListener = undefined;
    this.cleanupScrollModeListener?.();
    this.cleanupScrollModeListener = undefined;
    if (this.virtualizer) {
      this.virtualizer.primeMountedSnapshots();
      this.virtualizer.suspendForNativeEdit();
      this.records = this.virtualizer.getRecords();
      this.nativeEditRecoveryRecords = this.records.map((record) => cloneRecoveryRecord(record));
      this.syncSessionState();
    } else if (this.records.length > 0) {
      this.nativeEditRecoveryRecords = this.records.map((record) => cloneRecoveryRecord(record));
    }
    this.armActivationWatcher();
    void this.publishStats();
  }

  private findRecordIndexForTarget(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) {
      return null;
    }

    const wrapper = target.closest<HTMLElement>('.ecv-record-root[data-record-index]');
    if (!wrapper) {
      return null;
    }

    const rawIndex = wrapper.dataset.recordIndex;
    if (!rawIndex) {
      return null;
    }

    const parsed = Number(rawIndex);
    return Number.isInteger(parsed) ? parsed : null;
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

function cloneRecoveryRecord(record: QARecord): QARecord {
  return {
    ...record,
    elements: record.elements ? [...record.elements] : undefined
  };
}

function resolveEventElement(event: Event): Element | null {
  const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : [];
  for (const candidate of composedPath) {
    if (candidate instanceof Element) {
      return candidate;
    }
  }

  return event.target instanceof Element ? event.target : null;
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

function findContiguousRecoveryRanges(existingRecords: QARecord[], partialRecords: QARecord[]): number[] {
  if (partialRecords.length === 0 || partialRecords.length > existingRecords.length) {
    return [];
  }

  const lastStartIndex = existingRecords.length - partialRecords.length;
  const startIndices: number[] = [];

  for (let startIndex = 0; startIndex <= lastStartIndex; startIndex += 1) {
    let isMatch = true;
    for (let offset = 0; offset < partialRecords.length; offset += 1) {
      const left = existingRecords[startIndex + offset];
      const right = partialRecords[offset];
      if (!left || !right || !recordsAreCompatible(left, right)) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      startIndices.push(startIndex);
    }
  }

  return startIndices;
}

function mergeRecoveredRecordRange(sessionId: string, preservedRecords: QARecord[], partialRecords: QARecord[], startIndex: number): QARecord[] {
  const merged = preservedRecords.map((record) => cloneRecoveryRecord(record));

  for (let offset = 0; offset < partialRecords.length; offset += 1) {
    const preserved = preservedRecords[startIndex + offset];
    const partial = partialRecords[offset];
    if (!preserved || !partial) {
      continue;
    }

    merged[startIndex + offset] = {
      ...partial,
      id: preserved.id,
      index: preserved.index,
      sessionId,
      mounted: partial.mounted,
      renderMode: partial.mounted ? 'live' : preserved.renderMode,
      protectedUntil: preserved.protectedUntil,
      rootElement: null,
      detachedRoot: preserved.detachedRoot,
      liveRootCache: preserved.liveRootCache,
      snapshotHtml: preserved.snapshotHtml
    };
  }

  return merged;
}

function findAnchorGuidedRecoveryRange(
  preservedRecords: QARecord[],
  partialRecords: QARecord[],
  anchorIndex: number | null
): number | null {
  if (anchorIndex === null || partialRecords.length === 0 || partialRecords.length > preservedRecords.length) {
    return null;
  }

  const minStart = Math.max(0, anchorIndex - partialRecords.length + 1);
  const maxStart = Math.min(anchorIndex, preservedRecords.length - partialRecords.length);
  let bestStart: number | null = null;
  let bestScore = -1;

  for (let startIndex = minStart; startIndex <= maxStart; startIndex += 1) {
    const anchorOffset = anchorIndex - startIndex;
    const trailingCount = partialRecords.length - anchorOffset - 1;
    let matchesBefore = 0;
    let matchesAfter = 0;
    let mismatchesAfter = 0;

    for (let offset = 0; offset < partialRecords.length; offset += 1) {
      const left = preservedRecords[startIndex + offset];
      const right = partialRecords[offset];
      if (!left || !right || !recordsAreCompatible(left, right)) {
        if (offset > anchorOffset) {
          mismatchesAfter += 1;
        }
        continue;
      }

      if (offset < anchorOffset) {
        matchesBefore += 1;
      } else if (offset > anchorOffset) {
        matchesAfter += 1;
      }
    }

    const beforeCount = anchorOffset;
    const allBeforeMatched = beforeCount === matchesBefore;
    const allAfterMatched = trailingCount === matchesAfter;
    const canUseRange =
      (trailingCount > 0 && allAfterMatched) ||
      (trailingCount === 0 && beforeCount > 0 && allBeforeMatched);

    if (!canUseRange || mismatchesAfter > 0) {
      continue;
    }

    const score = matchesBefore + matchesAfter;
    if (score > bestScore) {
      bestScore = score;
      bestStart = startIndex;
    }
  }

  return bestStart;
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
