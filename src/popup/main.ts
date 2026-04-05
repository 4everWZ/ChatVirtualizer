import type { ExtensionConfig, SessionStats } from '@/shared/contracts';
import type { RuntimeMessage } from '@/shared/runtime-messages';

const enableVirtualization = document.querySelector<HTMLInputElement>('#enableVirtualization');
const enableSearch = document.querySelector<HTMLInputElement>('#enableSearch');
const sessionId = document.querySelector<HTMLElement>('#sessionId');
const totalRecords = document.querySelector<HTMLElement>('#totalRecords');
const mountedCount = document.querySelector<HTMLElement>('#mountedCount');
const placeholderCount = document.querySelector<HTMLElement>('#placeholderCount');
const toggleSearch = document.querySelector<HTMLButtonElement>('#toggleSearch');

void initialize();

async function initialize(): Promise<void> {
  const [config, stats] = await Promise.all([getConfig(), getStats()]);

  if (enableVirtualization) {
    enableVirtualization.checked = config.enableVirtualization;
    enableVirtualization.addEventListener('change', () => {
      void updateConfig({
        enableVirtualization: enableVirtualization.checked
      });
    });
  }

  if (enableSearch) {
    enableSearch.checked = config.enableSearch;
    enableSearch.addEventListener('change', () => {
      void updateConfig({
        enableSearch: enableSearch.checked
      });
    });
  }

  if (toggleSearch) {
    toggleSearch.addEventListener('click', () => {
      void openSearchOverlayInTargetTab();
    });
  }

  renderStats(stats);
}

function renderStats(stats?: SessionStats): void {
  if (sessionId) {
    sessionId.textContent = stats?.sessionId ?? 'Unavailable';
  }
  if (totalRecords) {
    totalRecords.textContent = `${stats?.totalRecords ?? 0}`;
  }
  if (mountedCount) {
    mountedCount.textContent = `${stats?.mountedCount ?? 0}`;
  }
  if (placeholderCount) {
    placeholderCount.textContent = `${stats?.placeholderCount ?? 0}`;
  }
}

async function getConfig(): Promise<ExtensionConfig> {
  return chrome.runtime.sendMessage({
    type: 'get-config'
  } satisfies RuntimeMessage);
}

async function getStats(): Promise<SessionStats | undefined> {
  return chrome.runtime.sendMessage({
    type: 'get-active-session-stats'
  } satisfies RuntimeMessage);
}

async function updateConfig(partial: Partial<ExtensionConfig>): Promise<void> {
  await chrome.runtime.sendMessage({
    type: 'update-config',
    payload: partial
  } satisfies RuntimeMessage);
}

async function openSearchOverlayInTargetTab(): Promise<void> {
  const tabs = await chrome.tabs.query({
    currentWindow: true
  });

  const targetTab =
    tabs.find((tab) => tab.active && isContentTab(tab)) ??
    tabs
      .filter((tab) => isContentTab(tab))
      .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];

  if (targetTab?.id === undefined) {
    return;
  }

  await chrome.tabs.sendMessage(targetTab.id, {
    type: 'toggle-search-overlay',
    payload: {
      forceOpen: true
    }
  } satisfies RuntimeMessage);
}

function isContentTab(tab: chrome.tabs.Tab): boolean {
  return Boolean(tab.url?.startsWith('http://') || tab.url?.startsWith('https://'));
}
