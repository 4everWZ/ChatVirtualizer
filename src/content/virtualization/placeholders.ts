interface CollapsedGroupRecord {
  recordId: string;
  summary?: string;
  textCombined: string;
}

interface CollapsedGroupInit {
  groupId: string;
  records: CollapsedGroupRecord[];
  onBeforeMatch?: (recordId: string, reservoir: HTMLElement) => void;
}

const COLLAPSED_GROUP_HEIGHT_PX = 44;

export function createCollapsedGroupElement(init: CollapsedGroupInit): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'ecv-collapsed-group';
  element.dataset.groupId = init.groupId;
  element.style.height = `${COLLAPSED_GROUP_HEIGHT_PX}px`;
  element.style.width = '100%';
  element.style.display = 'flex';
  element.style.alignItems = 'center';
  element.style.padding = '0 12px';
  element.style.boxSizing = 'border-box';
  element.style.borderRadius = '12px';
  element.style.background = 'rgba(148, 163, 184, 0.14)';
  element.style.color = 'rgba(15, 23, 42, 0.78)';
  element.style.fontSize = '13px';
  element.style.margin = '8px 0';

  const label = document.createElement('div');
  label.className = 'ecv-collapsed-group__summary';
  label.textContent = `Earlier messages · ${init.records.length}`;
  element.append(label);

  const reservoirs = document.createElement('div');
  reservoirs.className = 'ecv-collapsed-group__reservoirs';
  element.append(reservoirs);

  for (const record of init.records) {
    const reservoir = document.createElement('div');
    reservoir.dataset.recordId = record.recordId;
    reservoir.setAttribute('hidden', 'until-found');
    reservoir.textContent = normalizeText(record.textCombined);
    if (record.summary) {
      reservoir.setAttribute('aria-label', record.summary);
    }
    if (init.onBeforeMatch) {
      reservoir.addEventListener('beforematch', () => {
        init.onBeforeMatch?.(record.recordId, reservoir);
      });
    }
    reservoirs.append(reservoir);
  }

  return element;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
