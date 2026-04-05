import { DEFAULT_CONFIG } from '@/shared/config';
import type { ExtensionConfig, SessionStats } from '@/shared/contracts';
import type { RuntimeMessage } from '@/shared/runtime-messages';
import { ConfigStore } from '@/shared/storage/config-store';

const enableVirtualization = document.querySelector<HTMLInputElement>('#enableVirtualization');
const sessionId = document.querySelector<HTMLElement>('#sessionId');
const totalRecords = document.querySelector<HTMLElement>('#totalRecords');
const mountedCount = document.querySelector<HTMLElement>('#mountedCount');
const collapsedGroupCount = document.querySelector<HTMLElement>('#collapsedGroupCount');
const configStore = new ConfigStore();

void initialize();

async function initialize(): Promise<void> {
  applyConfig(DEFAULT_CONFIG);
  renderStats(undefined);

  const config = await getConfigSafe();
  applyConfig(config);

  const stats = await getStatsSafe();
  renderStats(stats);
}

function renderStats(stats?: SessionStats): void {
  if (sessionId) {
    sessionId.textContent = stats?.sessionId ?? 'No active conversation';
  }
  if (totalRecords) {
    totalRecords.textContent = `${stats?.totalRecords ?? 0}`;
  }
  if (mountedCount) {
    mountedCount.textContent = `${stats?.mountedCount ?? 0}`;
  }
  if (collapsedGroupCount) {
    collapsedGroupCount.textContent = `${stats?.collapsedGroupCount ?? 0}`;
  }
}

function applyConfig(config: ExtensionConfig): void {
  if (!enableVirtualization) {
    return;
  }

  enableVirtualization.checked = config.enableVirtualization;
  if (enableVirtualization.dataset.bound === 'true') {
    return;
  }

  enableVirtualization.dataset.bound = 'true';
  enableVirtualization.addEventListener('change', () => {
    void updateConfig({
      enableVirtualization: enableVirtualization.checked
    });
  });
}

async function getConfigSafe(): Promise<ExtensionConfig> {
  try {
    return await configStore.getConfig();
  } catch (error) {
    console.warn('[ECV] Failed to load popup config from storage.', error);
    return DEFAULT_CONFIG;
  }
}

async function getStatsSafe(): Promise<SessionStats | undefined> {
  try {
    return await getStats();
  } catch (error) {
    console.warn('[ECV] Failed to load popup stats.', error);
    return undefined;
  }
}

async function getStats(): Promise<SessionStats | undefined> {
  const tabs = await chrome.tabs.query({});

  const targetTab =
    tabs.find((tab) => tab.active && isContentTab(tab)) ??
    tabs
      .filter((tab) => isContentTab(tab))
      .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0];

  if (targetTab?.id !== undefined) {
    try {
      return (await chrome.tabs.sendMessage(targetTab.id, {
        type: 'get-active-session-stats'
      } satisfies RuntimeMessage)) as SessionStats | undefined;
    } catch {
      // Fall through to the background fallback when the content script is not ready.
    }
  }

  return chrome.runtime.sendMessage({
    type: 'get-active-session-stats'
  } satisfies RuntimeMessage);
}

async function updateConfig(partial: Partial<ExtensionConfig>): Promise<void> {
  try {
    const next = await configStore.updateConfig(partial);
    applyConfig(next);
  } catch (error) {
    console.warn('[ECV] Failed to persist popup config.', error);
    applyConfig(await getConfigSafe());
  }
}

function isContentTab(tab: chrome.tabs.Tab): boolean {
  if (!tab.url) {
    return false;
  }

  try {
    const url = new URL(tab.url);
    return (
      (url.protocol === 'https:' && (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com')) ||
      (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))
    );
  } catch {
    return false;
  }
}
