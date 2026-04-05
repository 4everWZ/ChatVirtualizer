import type { SessionStats } from '@/shared/contracts';
import type { RuntimeMessage } from '@/shared/runtime-messages';
import { ConfigStore } from '@/shared/storage/config-store';
import { IndexedDbSnapshotStore } from '@/shared/storage/snapshot-store';

const configStore = new ConfigStore();
const snapshotStore = new IndexedDbSnapshotStore();
const statsByTab = new Map<number, SessionStats>();

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void (async () => {
    switch (message.type) {
      case 'session-stats':
        if (sender.tab?.id !== undefined) {
          statsByTab.set(sender.tab.id, message.payload);
        }
        sendResponse({ ok: true });
        break;
      case 'get-active-session-stats':
        sendResponse(await getActiveSessionStats());
        break;
      case 'get-config':
        sendResponse(await configStore.getConfig());
        break;
      case 'update-config':
        sendResponse(await configStore.updateConfig(message.payload));
        break;
      case 'clear-snapshot-cache':
        await snapshotStore.clear();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse(undefined);
        break;
    }
  })();

  return true;
});

async function getActiveSessionStats(): Promise<SessionStats | undefined> {
  const targetTab = await getTargetContentTab();
  if (targetTab?.id === undefined) {
    return undefined;
  }

  try {
    return (await chrome.tabs.sendMessage(targetTab.id, {
      type: 'get-active-session-stats'
    } satisfies RuntimeMessage)) as SessionStats | undefined;
  } catch {
    return statsByTab.get(targetTab.id);
  }
}

async function getTargetContentTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});

  return (
    tabs.find((tab) => tab.active && isContentTab(tab)) ??
    tabs
      .filter((tab) => isContentTab(tab))
      .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0]
  );
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
