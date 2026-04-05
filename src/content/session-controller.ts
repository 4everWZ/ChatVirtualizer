import { CHATGPT_TURN_SELECTORS, ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { buildQaRecordsFromTurns } from '@/content/records/record-engine';
import { ScrollManager } from '@/content/scroll/scroll-manager';
import { VirtualizationEngine } from '@/content/virtualization/virtualization-engine';
import { getTopRestoreRange } from '@/content/virtualization/window-manager';
import { DEFAULT_CONFIG, mergeConfig } from '@/shared/config';
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
  private reindexTimer?: number;
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
    this.cleanupSessionObserver?.();
    this.cleanupSessionObserver = undefined;
    this.activationObserver?.disconnect();
    this.activationObserver = undefined;
    this.activationCheckQueued = false;
    this.scrollManager?.disconnect();
    this.scrollManager = undefined;
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;

    if (this.reindexTimer !== undefined) {
      clearTimeout(this.reindexTimer);
      this.reindexTimer = undefined;
    }

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
    this.scheduleInitialization();
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

    this.currentSessionState = {
      sessionId,
      recordIdsInOrder: this.records.map((record) => record.id),
      activeWindowStart: Math.max(this.records.length - this.config.windowSizeQa, 0),
      activeWindowEnd: Math.max(this.records.length - 1, 0),
      totalRecords: this.records.length,
      fullyIndexed: true
    };

    this.virtualizer = new VirtualizationEngine({
      config: this.config,
      logger: this.logger,
      snapshotStore: this.snapshotStore
    });

    await this.runWithoutMutationReindex(async () => {
      await this.virtualizer?.attach(scrollContainer, this.records);
      if (this.config.enableVirtualization) {
        await this.virtualizer?.applyInitialWindow();
      }
      this.records = this.virtualizer?.getRecords() ?? this.records;
    });

    this.scrollManager?.disconnect();
    this.scrollManager = new ScrollManager(scrollContainer, {
      topThresholdPx: this.config.topThresholdPx,
      onReachTop: () => this.restorePreviousBatch()
    });

    this.observeMutations();
    await this.publishStats();
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
    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.scrollManager?.disconnect();
    this.scrollManager = undefined;
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

  private scheduleInitialization(): void {
    this.clearInitializationTimer();
    this.initializationTimer = window.setTimeout(() => {
      this.initializationTimer = undefined;
      this.disarmActivationWatcher();
      void this.initializeSession();
    }, this.config.stabilityQuietMs);
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

      this.reindexTimer = window.setTimeout(() => {
        void this.reindexSession();
      }, this.config.stabilityQuietMs);
    });

    this.mutationObserver.observe(this.scrollContainer, {
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
    });
    const after = this.scrollContainer.scrollHeight;
    this.scrollContainer.scrollTop += after - before;
    this.currentSessionState.activeWindowStart = range.start;
    await this.publishStats();
  }

  private async reindexSession(): Promise<void> {
    const sessionId = this.adapter.getSessionId();
    if (!this.currentSessionState || !this.virtualizer || this.currentSessionState.sessionId !== sessionId) {
      await this.initializeSession();
      return;
    }

    const partialTurns = this.adapter.collectTurnCandidates();
    const partialRecords = buildQaRecordsFromTurns(partialTurns, sessionId);
    const mountedCount = this.records.filter((record) => record.mounted).length;

    if (this.virtualizer.getCollapsedGroupCount() > 0 && partialRecords.length <= mountedCount) {
      return;
    }

    if (this.virtualizer.getCollapsedGroupCount() > 0 && this.records.length > 0) {
      await this.runWithoutMutationReindex(async () => {
        await this.virtualizer?.restoreRange(0, this.records.length - 1);
        this.records = this.virtualizer?.getRecords() ?? this.records;
      });
    }

    await this.initializeSession();
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

function isRelevantTurnMutation(mutation: MutationRecord): boolean {
  return hasRelevantTurnNode(mutation.addedNodes) || hasRelevantTurnNode(mutation.removedNodes);
}

function hasRelevantTurnNode(nodes: NodeList): boolean {
  return Array.from(nodes).some((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    return node.matches(CHATGPT_TURN_SELECTORS) || node.querySelector(CHATGPT_TURN_SELECTORS) !== null;
  });
}
