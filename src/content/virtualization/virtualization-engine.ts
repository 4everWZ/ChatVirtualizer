import type { ExtensionConfig, QARecord, RecordSnapshot, SnapshotStore } from '@/shared/contracts';
import { Logger } from '@/shared/logger';
import { createPlaceholderElement } from './placeholders';
import { computeWindowPlan } from './window-manager';

interface VirtualizationEngineOptions {
  config: ExtensionConfig;
  logger?: Logger;
  snapshotStore: SnapshotStore;
}

export class VirtualizationEngine {
  private readonly config: ExtensionConfig;
  private readonly logger: Logger;
  private readonly snapshotStore: SnapshotStore;
  private readonly placeholderMap = new Map<string, HTMLElement>();
  private readonly snapshotCache = new Map<string, RecordSnapshot>();

  private records: QARecord[] = [];
  private scrollContainer: HTMLElement | null = null;

  constructor(options: VirtualizationEngineOptions) {
    this.config = options.config;
    this.snapshotStore = options.snapshotStore;
    this.logger = options.logger ?? new Logger(options.config.debugLogging);
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
  }

  async restoreRange(start: number, end: number): Promise<void> {
    for (const record of this.records.slice(start, end + 1)) {
      await this.restoreRecord(record);
    }
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

  getPlaceholderCount(): number {
    return this.placeholderMap.size;
  }

  getRecords(): QARecord[] {
    return this.records;
  }

  scrollToRecord(recordId: string): void {
    const record = this.findRecord(recordId);
    const target = record?.rootElement ?? this.placeholderMap.get(recordId);
    target?.scrollIntoView({
      block: 'center',
      behavior: 'smooth'
    });
  }

  private findRecord(recordId: string): QARecord | undefined {
    return this.records.find((record) => record.id === recordId);
  }

  private ensureWrapper(record: QARecord): void {
    if (record.rootElement?.isConnected) {
      return;
    }

    const connectedElements = (record.elements ?? []).filter((element) => element.isConnected);
    if (connectedElements.length === 0) {
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
    record.height = wrapper.getBoundingClientRect().height || record.height;
    record.mounted = true;
  }

  private async evictRecord(record: QARecord): Promise<void> {
    if (!record.rootElement?.isConnected || record.generating) {
      return;
    }

    const snapshot = this.createSnapshot(record);
    await this.snapshotStore.putSnapshot(snapshot);
    this.snapshotCache.set(record.id, snapshot);

    const placeholder = createPlaceholderElement({
      placeholderId: record.placeholderId,
      recordId: record.id,
      height: snapshot.height,
      summary: record.textUser || record.textCombined
    });

    record.rootElement.replaceWith(placeholder);
    record.snapshotHtml = snapshot.html;
    record.placeholderId = placeholder.dataset.placeholderId;
    record.rootElement = null;
    record.mounted = false;
    record.height = snapshot.height;
    this.placeholderMap.set(record.id, placeholder);
    this.logger.debug('Evicted record', record.id);
  }

  private async restoreRecord(record: QARecord): Promise<void> {
    if (record.mounted) {
      return;
    }

    const placeholder = this.placeholderMap.get(record.id);
    if (!placeholder?.isConnected) {
      return;
    }

    const snapshot = this.snapshotCache.get(record.id) ?? (await this.snapshotStore.getSnapshot(record.sessionId, record.id));
    if (!snapshot) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'ecv-record-root';
    wrapper.dataset.recordId = record.id;
    wrapper.dataset.recordIndex = `${record.index}`;
    wrapper.innerHTML = snapshot.html;

    placeholder.replaceWith(wrapper);
    this.placeholderMap.delete(record.id);
    record.rootElement = wrapper;
    record.snapshotHtml = snapshot.html;
    record.mounted = true;
    record.height = wrapper.getBoundingClientRect().height || snapshot.height;
    record.elements = Array.from(wrapper.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
    this.logger.debug('Restored record', record.id);
  }

  private createSnapshot(record: QARecord): RecordSnapshot {
    if (!record.rootElement) {
      throw new Error(`Record ${record.id} is missing a root element`);
    }

    const sanitizedHtml = sanitizeHtml(record.rootElement.innerHTML);
    const height = record.rootElement.getBoundingClientRect().height || record.height;
    const now = Date.now();

    return {
      sessionId: record.sessionId,
      recordId: record.id,
      html: sanitizedHtml,
      textCombined: record.textCombined,
      height,
      anchorSignature: record.anchorSignature ?? record.textCombined.slice(0, 80),
      createdAt: now,
      updatedAt: now
    };
  }
}

function sanitizeHtml(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const selector of ['script', 'iframe', 'object']) {
    template.content.querySelectorAll(selector).forEach((node) => node.remove());
  }
  return template.innerHTML;
}
