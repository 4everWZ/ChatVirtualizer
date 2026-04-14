import type { ExtensionConfig, QARecord, RecordSnapshot, SnapshotStore, WindowPlan } from '@/shared/contracts';
import { createCollapsedGroupId } from '@/shared/ids';
import { Logger } from '@/shared/logger';
import { createCollapsedGroupElement } from './placeholders';
import { computeWindowPlan } from './window-manager';

interface VirtualizationEngineOptions {
  config: ExtensionConfig;
  logger?: Logger;
  snapshotStore: SnapshotStore;
  detachedRootRetentionMs?: number;
  snapshotSerializeDelayMs?: number;
}

interface RestoreRangeOptions {
  forceLiveRecordIds?: string[];
}

interface CollapsedGroupRange {
  element: HTMLElement;
  endIndex: number;
  groupId: string;
  recordIds: string[];
  startIndex: number;
}

export class VirtualizationEngine {
  private readonly detachedRootRetentionMs: number;
  private readonly config: ExtensionConfig;
  private readonly logger: Logger;
  private readonly snapshotSerializeDelayMs: number;
  private readonly snapshotStore: SnapshotStore;
  private readonly pendingSnapshotWrites = new Map<string, Promise<void>>();
  private readonly snapshotCache = new Map<string, RecordSnapshot>();
  private readonly pendingSnapshotRecordIds = new Set<string>();
  private readonly detachedRootExpiry = new Map<string, number>();

  private collapsedGroups: CollapsedGroupRange[] = [];
  private records: QARecord[] = [];
  private scrollContainer: HTMLElement | null = null;
  private detachedRootReleaseTimer?: number;
  private snapshotSerializeTimer?: number;
  private cleanupInteractionListeners?: () => void;
  private readonly forcedLiveRecordIds = new Set<string>();
  private preferredLiveOrder: string[] = [];

  constructor(options: VirtualizationEngineOptions) {
    this.config = options.config;
    this.snapshotStore = options.snapshotStore;
    this.logger = options.logger ?? new Logger(options.config.debugLogging);
    this.detachedRootRetentionMs = options.detachedRootRetentionMs ?? 5_000;
    this.snapshotSerializeDelayMs = options.snapshotSerializeDelayMs ?? 1_000;
  }

  async attach(scrollContainer: HTMLElement, records: QARecord[]): Promise<void> {
    this.scrollContainer = scrollContainer;
    this.records = records;
    this.installInteractionListeners();

    for (const record of this.records) {
      this.ensureWrapper(record);
    }
  }

  async applyInitialWindow(): Promise<void> {
    await this.applyWindowPlan();
  }

  async applyWindowPlan(now = Date.now()): Promise<void> {
    const plan = computeWindowPlan(this.records, this.config, now, {
      forcedLiveRecordIds: this.forcedLiveRecordIds,
      preferredLiveOrder: this.preferredLiveOrder
    });

    this.logger.debug('Applying window plan', {
      evictCount: plan.evictRecordIds.length,
      liteCount: plan.liteRecordIds.length,
      liveCount: plan.liveRecordIds.length,
      mountCount: plan.mountRecordIds.length,
      mountRecordIds: plan.mountRecordIds
    });

    const resolvedMountRecordIds: string[] = [];

    for (const recordId of plan.mountRecordIds) {
      const record = this.findRecord(recordId);
      if (!record) {
        continue;
      }

      if (record.mounted) {
        resolvedMountRecordIds.push(record.id);
        continue;
      }

      if (await this.restoreRecord(record)) {
        resolvedMountRecordIds.push(record.id);
      }
    }

    const safeEvictRecordIds =
      resolvedMountRecordIds.length === 0
        ? []
        : this.records
            .filter((record) => record.mounted && !resolvedMountRecordIds.includes(record.id))
            .map((record) => record.id);

    if (plan.evictRecordIds.length > 0 && safeEvictRecordIds.length === 0 && resolvedMountRecordIds.length === 0) {
      this.logger.warn('Skipped unsafe window eviction because no replacement records could be restored.', {
        requestedEvictions: plan.evictRecordIds,
        requestedMounts: plan.mountRecordIds
      });
    }

    for (const recordId of safeEvictRecordIds) {
      const record = this.findRecord(recordId);
      if (record) {
        await this.evictRecord(record);
      }
    }

    this.applyMountedRenderModes();
    this.renderCollapsedGroups();
  }

  async restoreRange(start: number, end: number, options: RestoreRangeOptions = {}): Promise<void> {
    if (options.forceLiveRecordIds) {
      this.setForcedLiveRecordIds(options.forceLiveRecordIds);
    }

    for (const record of this.records.slice(start, end + 1)) {
      await this.restoreRecord(record);
    }

    this.applyMountedRenderModes();
    this.renderCollapsedGroups();
  }

  refreshCollapsedGroups(): void {
    this.renderCollapsedGroups();
  }

  dispose(): void {
    if (this.snapshotSerializeTimer !== undefined) {
      clearTimeout(this.snapshotSerializeTimer);
      this.snapshotSerializeTimer = undefined;
    }

    if (this.detachedRootReleaseTimer !== undefined) {
      clearTimeout(this.detachedRootReleaseTimer);
      this.detachedRootReleaseTimer = undefined;
    }

    this.pendingSnapshotRecordIds.clear();
    this.detachedRootExpiry.clear();
    this.preferredLiveOrder = [];
    this.forcedLiveRecordIds.clear();
    this.cleanupInteractionListeners?.();
    this.cleanupInteractionListeners = undefined;

    for (const group of this.collapsedGroups) {
      group.element.remove();
    }
    this.collapsedGroups = [];
  }

  protectRange(start: number, end: number, ttlMs: number): void {
    const protectedUntil = Date.now() + ttlMs;
    for (const record of this.records.slice(start, end + 1)) {
      record.protectedUntil = protectedUntil;
    }
  }

  getMountedCount(): number {
    return this.records.filter((record) => record.mounted).length;
  }

  getCollapsedGroupCount(): number {
    return this.collapsedGroups.length;
  }

  getRecords(): QARecord[] {
    return this.records;
  }

  clearForcedLiveRecordIds(): void {
    this.forcedLiveRecordIds.clear();
  }

  suspendForNativeEdit(): void {
    if (this.snapshotSerializeTimer !== undefined) {
      clearTimeout(this.snapshotSerializeTimer);
      this.snapshotSerializeTimer = undefined;
    }

    if (this.detachedRootReleaseTimer !== undefined) {
      clearTimeout(this.detachedRootReleaseTimer);
      this.detachedRootReleaseTimer = undefined;
    }

    for (const group of this.collapsedGroups) {
      group.element.remove();
    }
    this.collapsedGroups = [];
    this.forcedLiveRecordIds.clear();
    this.preferredLiveOrder = [];
    this.cleanupInteractionListeners?.();
    this.cleanupInteractionListeners = undefined;

    for (const record of this.records) {
      if (!record.mounted) {
        continue;
      }

      this.ensureLiveRecord(record);
      const wrapper = record.rootElement;
      if (!wrapper) {
        record.rootElement = null;
        record.liveRootCache = null;
        record.mounted = false;
        record.renderMode = 'collapsed';
        continue;
      }

      if (!wrapper.isConnected) {
        record.elements = Array.from(wrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
        record.rootElement = null;
        record.liveRootCache = null;
        record.mounted = false;
        record.renderMode = 'collapsed';
        continue;
      }

      const parent = wrapper.parentElement;
      if (!parent) {
        record.elements = Array.from(wrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
        record.rootElement = null;
        record.liveRootCache = null;
        record.mounted = false;
        record.renderMode = 'collapsed';
        continue;
      }

      const elements = Array.from(wrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      wrapper.remove();

      record.elements = elements;
      record.rootElement = null;
      record.liveRootCache = null;
      record.mounted = false;
      record.renderMode = 'collapsed';
    }
  }

  scrollToRecord(recordId: string): void {
    const record = this.findRecord(recordId);
    const target = record?.rootElement ?? this.findCollapsedGroupForRecord(recordId)?.element;
    if (!target || typeof target.scrollIntoView !== 'function') {
      return;
    }

    target.scrollIntoView({
      block: 'center',
      behavior: 'smooth'
    });
  }

  private findRecord(recordId: string): QARecord | undefined {
    return this.records.find((record) => record.id === recordId);
  }

  private findCollapsedGroupForRecord(recordId: string): CollapsedGroupRange | undefined {
    return this.collapsedGroups.find((group) => group.recordIds.includes(recordId));
  }

  private installInteractionListeners(): void {
    this.cleanupInteractionListeners?.();
    this.cleanupInteractionListeners = undefined;

    const threadRoot = this.getThreadRoot();
    if (!threadRoot) {
      return;
    }

    const promoteFromTarget = (target: EventTarget | null) => {
      const recordId = this.findLiteRecordIdFromTarget(target);
      if (!recordId) {
        return;
      }

      this.rememberPreferredLiveRecord(recordId);
      this.applyMountedRenderModes();
    };

    const onClick = (event: Event) => {
      promoteFromTarget(event.target);
    };
    const onFocusIn = (event: FocusEvent) => {
      promoteFromTarget(event.target);
    };
    const onPointerEnter = (event: PointerEvent) => {
      promoteFromTarget(event.target);
    };
    const onSelectionChange = () => {
      const selection = document.getSelection();
      if (!selection) {
        return;
      }

      const anchorNode = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
      promoteFromTarget(anchorNode ?? null);
    };

    threadRoot.addEventListener('click', onClick, true);
    threadRoot.addEventListener('focusin', onFocusIn, true);
    threadRoot.addEventListener('pointerenter', onPointerEnter, true);
    document.addEventListener('selectionchange', onSelectionChange);

    this.cleanupInteractionListeners = () => {
      threadRoot.removeEventListener('click', onClick, true);
      threadRoot.removeEventListener('focusin', onFocusIn, true);
      threadRoot.removeEventListener('pointerenter', onPointerEnter, true);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }

  private ensureWrapper(record: QARecord): void {
    if (record.rootElement?.isConnected) {
      this.applyRenderMetadata(record);
      return;
    }

    const connectedElements = (record.elements ?? []).filter((element) => element.isConnected);
    if (connectedElements.length === 0) {
      return;
    }

    const existingWrapper = findSharedRecordWrapper(connectedElements);
    if (existingWrapper) {
      record.rootElement = existingWrapper;
      record.mounted = true;
      record.renderMode = record.renderMode === 'collapsed' ? 'live' : record.renderMode;
      record.elements = Array.from(existingWrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
      this.applyRenderMetadata(record);
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'ecv-record-root';
    wrapper.dataset.recordId = record.id;
    wrapper.dataset.recordIndex = `${record.index}`;

    connectedElements[0]?.before(wrapper);
    for (const element of connectedElements) {
      wrapper.append(element);
    }

    record.rootElement = wrapper;
    record.mounted = true;
    record.renderMode = record.renderMode === 'collapsed' ? 'live' : record.renderMode;
    this.applyRenderMetadata(record);
  }

  private async evictRecord(record: QARecord): Promise<void> {
    if (!record.rootElement?.isConnected || record.generating) {
      return;
    }

    const detachedRoot = record.liveRootCache ?? record.rootElement;
    record.rootElement.remove();
    record.detachedRoot = detachedRoot;
    record.liveRootCache = null;
    record.rootElement = null;
    record.mounted = false;
    record.renderMode = 'collapsed';
    this.pendingSnapshotRecordIds.add(record.id);
    this.detachedRootExpiry.set(record.id, Date.now() + this.detachedRootRetentionMs);
    this.scheduleSnapshotSerialization();
    this.scheduleDetachedRootRelease();
    this.logger.debug('Evicted record', record.id);
  }

  private async restoreRecord(record: QARecord): Promise<boolean> {
    if (record.mounted) {
      return true;
    }

    if (record.detachedRoot) {
      const wrapper = record.detachedRoot;
      const reference = this.findNextDomSibling(record.index);
      if (reference) {
        reference.before(wrapper);
      } else {
        this.getThreadRoot()?.append(wrapper);
      }

      record.detachedRoot = null;
      this.detachedRootExpiry.delete(record.id);
      this.scheduleDetachedRootRelease();
      record.rootElement = wrapper;
      record.mounted = true;
      record.renderMode = 'live';
      record.elements = Array.from(wrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
      this.applyRenderMetadata(record);
      this.logger.debug('Restored record from detached DOM', record.id);
      return true;
    }

    const snapshot = this.snapshotCache.get(record.id) ?? (await this.snapshotStore.getSnapshot(record.sessionId, record.id));
    if (!snapshot) {
      return false;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'ecv-record-root';
    wrapper.dataset.recordId = record.id;
    wrapper.dataset.recordIndex = `${record.index}`;
    wrapper.innerHTML = snapshot.html;

    const reference = this.findNextDomSibling(record.index);
    if (reference) {
      reference.before(wrapper);
    } else {
      this.getThreadRoot()?.append(wrapper);
    }

    record.rootElement = wrapper;
    record.snapshotHtml = snapshot.html;
    record.mounted = true;
    record.renderMode = 'live';
    record.height = snapshot.height;
    record.elements = Array.from(wrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
    this.applyRenderMetadata(record);
    this.logger.debug('Restored record', record.id);
    return true;
  }

  private renderCollapsedGroups(): void {
    for (const group of this.collapsedGroups) {
      group.element.remove();
    }
    this.collapsedGroups = [];

    const threadRoot = this.getThreadRoot();
    if (!threadRoot) {
      return;
    }

    let rangeStart: number | null = null;

    for (let index = 0; index <= this.records.length; index += 1) {
      const record = this.records[index];
      const isCollapsed = record !== undefined && !record.mounted;

      if (isCollapsed && rangeStart === null) {
        rangeStart = index;
      }

      if (rangeStart === null) {
        continue;
      }

      if (isCollapsed) {
        continue;
      }

      const startIndex = rangeStart;
      const endIndex = index - 1;
      const rangeRecords = this.records.slice(startIndex, endIndex + 1);
      const groupId = createCollapsedGroupId(rangeRecords[0]?.sessionId ?? 'session', startIndex, endIndex);

      const group = createCollapsedGroupElement({
        groupId,
        onBeforeMatch: (recordId, reservoir) => {
          void this.handleBeforeMatch(recordId, reservoir);
        },
        records: rangeRecords.map((collapsedRecord) => ({
          recordId: collapsedRecord.id,
          summary: collapsedRecord.textUser || collapsedRecord.textCombined,
          textCombined: collapsedRecord.textCombined
        }))
      });

      const reference = this.findNextMountedElement(endIndex);
      if (reference) {
        reference.before(group);
      } else {
        threadRoot.append(group);
      }

      this.collapsedGroups.push({
        element: group,
        endIndex,
        groupId,
        recordIds: rangeRecords.map((collapsedRecord) => collapsedRecord.id),
        startIndex
      });

      rangeStart = null;
    }
  }

  private async handleBeforeMatch(recordId: string, reservoir: HTMLElement): Promise<void> {
    const targetIndex = this.records.findIndex((record) => record.id === recordId);
    if (targetIndex < 0) {
      return;
    }

    const start = Math.max(0, targetIndex - this.config.searchContextBefore);
    const end = Math.min(this.records.length - 1, targetIndex + this.config.searchContextAfter);
    await this.restoreRange(start, end, {
      forceLiveRecordIds: this.records.slice(start, end + 1).map((record) => record.id)
    });

    const restored = this.findRecord(recordId);
    if (restored?.mounted) {
      this.scrollToRecord(recordId);
      return;
    }

    reservoir.removeAttribute('hidden');
  }

  private findNextDomSibling(index: number): HTMLElement | null {
    for (let nextIndex = index + 1; nextIndex < this.records.length; nextIndex += 1) {
      const mountedRecord = this.records[nextIndex];
      if (mountedRecord?.rootElement?.isConnected) {
        return mountedRecord.rootElement;
      }

      const group = this.collapsedGroups.find((candidate) => candidate.startIndex === nextIndex);
      if (group?.element.isConnected) {
        return group.element;
      }
    }

    return null;
  }

  private findNextMountedElement(index: number): HTMLElement | null {
    for (let nextIndex = index + 1; nextIndex < this.records.length; nextIndex += 1) {
      const mountedRecord = this.records[nextIndex];
      if (mountedRecord?.rootElement?.isConnected) {
        return mountedRecord.rootElement;
      }
    }

    return null;
  }

  private getThreadRoot(): HTMLElement | null {
    return this.scrollContainer?.querySelector<HTMLElement>('#thread') ?? this.scrollContainer;
  }

  private applyMountedRenderModes(plan?: Pick<WindowPlan, 'liveRecordIds' | 'liteRecordIds' | 'mountRecordIds'>): void {
    const visibleRecordIds = plan?.mountRecordIds ?? this.records.filter((record) => record.mounted).map((record) => record.id);
    const visibleSet = new Set(visibleRecordIds);
    const liveRecordIds = plan?.liveRecordIds ?? this.computeLiveRecordIds(visibleRecordIds);
    const liveSet = new Set(liveRecordIds);
    const liteRecordIds = plan?.liteRecordIds ?? visibleRecordIds.filter((recordId) => !liveSet.has(recordId));

    this.preferredLiveOrder = this.preferredLiveOrder.filter((recordId) => visibleSet.has(recordId));
    for (const forcedRecordId of Array.from(this.forcedLiveRecordIds)) {
      if (!visibleSet.has(forcedRecordId)) {
        this.forcedLiveRecordIds.delete(forcedRecordId);
      }
    }

    for (const recordId of liteRecordIds) {
      const record = this.findRecord(recordId);
      if (record) {
        this.ensureLiteRecord(record);
      }
    }

    for (const recordId of liveRecordIds) {
      const record = this.findRecord(recordId);
      if (record) {
        this.ensureLiveRecord(record);
      }
    }

    for (const record of this.records) {
      if (!visibleSet.has(record.id)) {
        record.renderMode = 'collapsed';
      }
    }
  }

  private computeLiveRecordIds(visibleRecordIds: string[]): string[] {
    const visibleSet = new Set(visibleRecordIds);
    const visibleRecords = this.records.filter((record) => visibleSet.has(record.id));
    const protectedIds = visibleRecords.filter((record) => this.isProtectedRecord(record)).map((record) => record.id);
    const forcedIds = visibleRecords.filter((record) => this.forcedLiveRecordIds.has(record.id)).map((record) => record.id);
    const preferredIds = this.preferredLiveOrder.filter(
      (recordId) => visibleSet.has(recordId) && !this.forcedLiveRecordIds.has(recordId) && !this.isProtectedRecord(this.findRecord(recordId))
    );
    const budgetedPreferredIds = preferredIds.slice(-4);
    const remainingHotSlots = Math.max(0, 4 - budgetedPreferredIds.length);
    const fallbackTailIds =
      remainingHotSlots === 0
        ? []
        : visibleRecords
            .filter(
              (record) =>
                !this.isProtectedRecord(record) &&
                !this.forcedLiveRecordIds.has(record.id) &&
                !budgetedPreferredIds.includes(record.id)
            )
            .slice(-remainingHotSlots)
            .map((record) => record.id);

    return Array.from(new Set([...protectedIds, ...forcedIds, ...budgetedPreferredIds, ...fallbackTailIds]));
  }

  private ensureLiteRecord(record: QARecord): void {
    if (!record.mounted || !record.rootElement) {
      return;
    }

    if (record.renderMode === 'lite') {
      this.applyRenderMetadata(record);
      return;
    }

    const liveRoot = record.rootElement;
    if (!record.snapshotHtml) {
      const snapshot = this.createSnapshot(record, liveRoot);
      this.snapshotCache.set(record.id, snapshot);
      record.snapshotHtml = snapshot.html;
      this.queueSnapshotPersist(snapshot);
    }

    const liteRoot = this.createRootFromHtml(record, record.snapshotHtml ?? '');
    liveRoot.replaceWith(liteRoot);
    record.liveRootCache = liveRoot;
    record.rootElement = liteRoot;
    record.elements = Array.from(liteRoot.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
    record.renderMode = 'lite';
    this.applyRenderMetadata(record);
  }

  private ensureLiveRecord(record: QARecord): void {
    if (!record.mounted) {
      return;
    }

    if (record.renderMode === 'live' && record.rootElement?.isConnected) {
      this.applyRenderMetadata(record);
      return;
    }

    const currentRoot = record.rootElement;
    const liveRoot = record.liveRootCache;
    if (currentRoot && liveRoot) {
      currentRoot.replaceWith(liveRoot);
      record.rootElement = liveRoot;
      record.liveRootCache = null;
      record.elements = Array.from(liveRoot.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
    }

    record.renderMode = 'live';
    this.applyRenderMetadata(record);
  }

  private createRootFromHtml(record: QARecord, html: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'ecv-record-root';
    wrapper.dataset.recordId = record.id;
    wrapper.dataset.recordIndex = `${record.index}`;
    wrapper.innerHTML = html;
    return wrapper;
  }

  private applyRenderMetadata(record: QARecord): void {
    if (!record.rootElement) {
      return;
    }

    record.rootElement.dataset.renderMode = record.renderMode;
    record.rootElement.classList.toggle('ecv-record-root--lite', record.renderMode === 'lite');
    record.rootElement.classList.toggle('ecv-record-root--live', record.renderMode === 'live');
  }

  private rememberPreferredLiveRecord(recordId: string): void {
    this.preferredLiveOrder = this.preferredLiveOrder.filter((candidate) => candidate !== recordId);
    this.preferredLiveOrder.push(recordId);
  }

  private setForcedLiveRecordIds(recordIds: Iterable<string>): void {
    this.forcedLiveRecordIds.clear();
    for (const recordId of recordIds) {
      this.forcedLiveRecordIds.add(recordId);
    }
  }

  private findLiteRecordIdFromTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) {
      return null;
    }

    const recordRoot = target.closest<HTMLElement>('.ecv-record-root[data-render-mode="lite"]');
    return recordRoot?.dataset.recordId ?? null;
  }

  private isProtectedRecord(record: QARecord | undefined, now = Date.now()): boolean {
    if (!record) {
      return false;
    }

    return record.generating || (record.protectedUntil !== undefined && record.protectedUntil > now);
  }

  private createSnapshot(record: QARecord, sourceRoot: HTMLElement | null): RecordSnapshot {
    if (!sourceRoot) {
      throw new Error(`Record ${record.id} is missing a root element`);
    }

    const sanitizedHtml = createLightweightSnapshotHtml(sourceRoot);
    const now = Date.now();

    return {
      sessionId: record.sessionId,
      recordId: record.id,
      html: sanitizedHtml,
      textCombined: record.textCombined,
      height: record.height,
      anchorSignature: record.anchorSignature ?? record.textCombined.slice(0, 80),
      createdAt: now,
      updatedAt: now
    };
  }

  private queueSnapshotPersist(snapshot: RecordSnapshot): void {
    const writeKey = `${snapshot.sessionId}:${snapshot.recordId}`;
    const writePromise = this.snapshotStore
      .putSnapshot(snapshot)
      .catch((error) => {
        this.logger.warn('Failed to persist snapshot', writeKey, error);
      })
      .finally(() => {
        if (this.pendingSnapshotWrites.get(writeKey) === writePromise) {
          this.pendingSnapshotWrites.delete(writeKey);
        }
      });

    this.pendingSnapshotWrites.set(writeKey, writePromise);
  }

  private scheduleSnapshotSerialization(): void {
    if (this.snapshotSerializeTimer !== undefined) {
      return;
    }

    this.snapshotSerializeTimer = window.setTimeout(() => {
      this.snapshotSerializeTimer = undefined;
      void this.flushPendingSnapshotSerialization();
    }, this.snapshotSerializeDelayMs);
  }

  private async flushPendingSnapshotSerialization(): Promise<void> {
    const recordIds = Array.from(this.pendingSnapshotRecordIds);
    this.pendingSnapshotRecordIds.clear();

    for (const recordId of recordIds) {
      const record = this.findRecord(recordId);
      if (!record || record.mounted || !record.detachedRoot || this.snapshotCache.has(recordId)) {
        continue;
      }

      const snapshot = this.createSnapshot(record, record.detachedRoot);
      this.snapshotCache.set(record.id, snapshot);
      record.snapshotHtml = snapshot.html;
      this.queueSnapshotPersist(snapshot);
    }

    this.releaseExpiredDetachedRoots();
  }

  private scheduleDetachedRootRelease(): void {
    if (this.detachedRootReleaseTimer !== undefined) {
      clearTimeout(this.detachedRootReleaseTimer);
      this.detachedRootReleaseTimer = undefined;
    }

    const nextExpiry = Math.min(...Array.from(this.detachedRootExpiry.values()));
    if (!Number.isFinite(nextExpiry)) {
      return;
    }

    const delay = Math.max(0, nextExpiry - Date.now());
    this.detachedRootReleaseTimer = window.setTimeout(() => {
      this.detachedRootReleaseTimer = undefined;
      this.releaseExpiredDetachedRoots();
    }, delay);
  }

  private releaseExpiredDetachedRoots(now = Date.now()): void {
    for (const [recordId, expiry] of this.detachedRootExpiry.entries()) {
      const record = this.findRecord(recordId);
      if (!record || record.mounted || !record.detachedRoot) {
        this.detachedRootExpiry.delete(recordId);
        continue;
      }

      if (expiry > now || !this.snapshotCache.has(recordId)) {
        continue;
      }

      record.detachedRoot = null;
      this.detachedRootExpiry.delete(recordId);
      this.logger.debug('Released detached root after ttl', record.id);
    }

    this.scheduleDetachedRootRelease();
  }

  async persistCollapsedSnapshots(): Promise<void> {
    if (this.snapshotSerializeTimer !== undefined) {
      clearTimeout(this.snapshotSerializeTimer);
      this.snapshotSerializeTimer = undefined;
    }

    await this.flushPendingSnapshotSerialization();

    for (const record of this.records) {
      if (!record.detachedRoot || record.mounted || this.snapshotCache.has(record.id)) {
        continue;
      }

      const snapshot = this.createSnapshot(record, record.detachedRoot);
      this.snapshotCache.set(record.id, snapshot);
      record.snapshotHtml = snapshot.html;
      this.queueSnapshotPersist(snapshot);
      record.detachedRoot = null;
      this.detachedRootExpiry.delete(record.id);
    }

    this.scheduleDetachedRootRelease();
  }
}

function createLightweightSnapshotHtml(sourceRoot: HTMLElement): string {
  const clone = sourceRoot.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    return '';
  }

  for (const selector of ['script', 'iframe', 'object', '.ecv-collapsed-group', '[hidden="until-found"][data-record-id]']) {
    clone.querySelectorAll(selector).forEach((node) => node.remove());
  }

  for (const selector of [
    'button',
    '[role="button"]',
    '[data-testid="copy-turn-action-button"]',
    '[data-testid="good-response-turn-action-button"]',
    '[data-testid="bad-response-turn-action-button"]',
    '[data-testid="webpage-citation-pill"]'
  ]) {
    clone.querySelectorAll(selector).forEach((node) => node.remove());
  }

  const template = document.createElement('template');
  template.innerHTML = clone.innerHTML;
  return template.innerHTML;
}

function findSharedRecordWrapper(elements: HTMLElement[]): HTMLElement | null {
  const [firstElement] = elements;
  const parent = firstElement?.parentElement;
  if (!(parent instanceof HTMLElement) || !parent.classList.contains('ecv-record-root')) {
    return null;
  }

  return elements.every((element) => element.parentElement === parent) ? parent : null;
}
