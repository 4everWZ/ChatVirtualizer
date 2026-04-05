import type { ExtensionConfig, SessionStats } from '@/shared/contracts';
import type { RuntimeMessage } from '@/shared/runtime-messages';

const enableVirtualization = document.querySelector<HTMLInputElement>('#enableVirtualization');
const sessionId = document.querySelector<HTMLElement>('#sessionId');
const totalRecords = document.querySelector<HTMLElement>('#totalRecords');
const mountedCount = document.querySelector<HTMLElement>('#mountedCount');
const collapsedGroupCount = document.querySelector<HTMLElement>('#collapsedGroupCount');

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

async function getConfig(): Promise<ExtensionConfig> {
  return chrome.runtime.sendMessage({
    type: 'get-config'
  } satisfies RuntimeMessage);
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
  await chrome.runtime.sendMessage({
    type: 'update-config',
    payload: partial
  } satisfies RuntimeMessage);
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
