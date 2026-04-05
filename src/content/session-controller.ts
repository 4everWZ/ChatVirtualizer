import { ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
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
      this.resetSessionState();
      this.armActivationWatcher();
      await this.publishStats();
      return;
    }

    this.disarmActivationWatcher();
    await this.initializeSession();
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

    this.isApplyingDomChanges = true;
    try {
      await this.virtualizer.attach(scrollContainer, this.records);
      if (this.config.enableVirtualization) {
        await this.virtualizer.applyInitialWindow();
      }
      this.records = this.virtualizer.getRecords();
    } finally {
      this.isApplyingDomChanges = false;
    }

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

  private observeMutations(): void {
    this.mutationObserver?.disconnect();
    if (!this.scrollContainer) {
      return;
    }

    this.mutationObserver = new MutationObserver(() => {
      if (this.isApplyingDomChanges) {
        return;
      }

      if (this.reindexTimer !== undefined) {
        clearTimeout(this.reindexTimer);
      }

      this.reindexTimer = window.setTimeout(() => {
        void this.initializeSession();
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
    await this.virtualizer.restoreRange(range.start, range.end);
    const after = this.scrollContainer.scrollHeight;
    this.scrollContainer.scrollTop += after - before;
    this.currentSessionState.activeWindowStart = range.start;
    await this.publishStats();
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
