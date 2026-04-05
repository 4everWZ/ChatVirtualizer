import type { ExtensionConfig } from '@/shared/contracts';
import type { RuntimeMessage } from '@/shared/runtime-messages';

const fieldIds: Array<keyof ExtensionConfig> = [
  'windowSizeQa',
  'loadBatchQa',
  'topThresholdPx',
  'preloadBufferPx',
  'searchContextBefore',
  'searchContextAfter',
  'protectGenerating',
  'enableSearch',
  'enableVirtualization',
  'debugLogging',
  'maxPersistedSessions',
  'stabilityQuietMs'
];

const form = document.querySelector<HTMLFormElement>('#optionsForm');
const status = document.querySelector<HTMLElement>('#status');
const clearCache = document.querySelector<HTMLButtonElement>('#clearCache');

void initialize();

async function initialize(): Promise<void> {
  const config = (await chrome.runtime.sendMessage({
    type: 'get-config'
  } satisfies RuntimeMessage)) as ExtensionConfig;

  for (const fieldId of fieldIds) {
    const element = document.querySelector<HTMLInputElement>(`#${fieldId}`);
    if (!element) {
      continue;
    }

    if (element.type === 'checkbox') {
      element.checked = Boolean(config[fieldId]);
    } else {
      element.value = `${config[fieldId]}`;
    }
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void save();
  });

  clearCache?.addEventListener('click', () => {
    void chrome.runtime.sendMessage({
      type: 'clear-snapshot-cache'
    } satisfies RuntimeMessage);

    if (status) {
      status.textContent = 'Local cache cleared.';
    }
  });
}

async function save(): Promise<void> {
  const payload: Partial<ExtensionConfig> = {};

  for (const fieldId of fieldIds) {
    const element = document.querySelector<HTMLInputElement>(`#${fieldId}`);
    if (!element) {
      continue;
    }

    if (element.type === 'checkbox') {
      payload[fieldId] = element.checked as never;
    } else {
      payload[fieldId] = Number(element.value) as never;
    }
  }

  await chrome.runtime.sendMessage({
    type: 'update-config',
    payload
  } satisfies RuntimeMessage);

  if (status) {
    status.textContent = 'Options saved.';
  }
}
