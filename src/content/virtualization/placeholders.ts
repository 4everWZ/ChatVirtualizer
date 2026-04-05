import { createPlaceholderId } from '@/shared/ids';

interface PlaceholderInit {
  placeholderId?: string;
  recordId: string;
  height: number;
  summary?: string;
}

export function createPlaceholderElement(init: PlaceholderInit): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'ecv-placeholder';
  element.dataset.recordId = init.recordId;
  element.dataset.placeholderId = init.placeholderId ?? createPlaceholderId(init.recordId);
  element.dataset.restorable = 'true';
  element.style.height = `${Math.max(init.height, 1)}px`;
  element.style.width = '100%';
  element.hidden = false;

  if (init.summary) {
    element.setAttribute('aria-label', init.summary);
  }

  return element;
}
