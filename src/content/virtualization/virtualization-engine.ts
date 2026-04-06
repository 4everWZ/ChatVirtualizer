import type { ExtensionConfig, QARecord, RecordSnapshot, SnapshotStore } from '@/shared/contracts';
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

    for (const record of this.records) {
      this.ensureWrapper(record);
    }
  }

  async applyInitialWindow(): Promise<void> {
    await this.applyWindowPlan();
  }

  async applyWindowPlan(now = Date.now()): Promise<void> {
    const plan = computeWindowPlan(this.records, this.config, now);

    for (const recordId of plan.mountRecordIds) {
      const record = this.findRecord(recordId);
      if (record && !record.mounted) {
        await this.restoreRecord(record);
      }
    }

    for (const recordId of plan.evictRecordIds) {
      const record = this.findRecord(recordId);
      if (record) {
        await this.evictRecord(record);
      }
    }

    this.renderCollapsedGroups();
  }

  async restoreRange(start: number, end: number): Promise<void> {
    for (const record of this.records.slice(start, end + 1)) {
      await this.restoreRecord(record);
    }

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

  private ensureWrapper(record: QARecord): void {
    if (record.rootElement?.isConnected) {
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
      record.elements = Array.from(existingWrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
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
  }

  private async evictRecord(record: QARecord): Promise<void> {
    if (!record.rootElement?.isConnected || record.generating) {
      return;
    }

    const detachedRoot = record.rootElement;
    detachedRoot.remove();
    record.detachedRoot = detachedRoot;
    record.rootElement = null;
    record.mounted = false;
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
      record.elements = Array.from(wrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
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
    record.height = snapshot.height;
    record.elements = Array.from(wrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
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
    await this.restoreRange(start, end);

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
