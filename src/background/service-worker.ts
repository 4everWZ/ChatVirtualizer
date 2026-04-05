import type { SessionStats } from '@/shared/contracts';
import type { RuntimeMessage } from '@/shared/runtime-messages';
import { ConfigStore } from '@/shared/storage/config-store';
import { IndexedDbSnapshotStore } from '@/shared/storage/snapshot-store';

const configStore = new ConfigStore();
const snapshotStore = new IndexedDbSnapshotStore();
const statsByTab = new Map<number, SessionStats>();

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle_search_overlay') {
    return;
  }

  void toggleSearchOverlayOnActiveTab();
});

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
      case 'toggle-search-overlay':
        await toggleSearchOverlayOnActiveTab(message.payload?.forceOpen);
        sendResponse({ ok: true });
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

  return statsByTab.get(targetTab.id);
}

async function toggleSearchOverlayOnActiveTab(forceOpen?: boolean): Promise<void> {
  const targetTab = await getTargetContentTab();
  if (targetTab?.id === undefined) {
    return;
  }

  await chrome.tabs.sendMessage(targetTab.id, {
    type: 'toggle-search-overlay',
    payload: {
      forceOpen
    }
  } satisfies RuntimeMessage);
}

async function getTargetContentTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({
    currentWindow: true
  });

  return (
    tabs.find((tab) => tab.active && isContentTab(tab)) ??
    tabs
      .filter((tab) => isContentTab(tab))
      .sort((left, right) => (right.lastAccessed ?? 0) - (left.lastAccessed ?? 0))[0]
  );
}

function isContentTab(tab: chrome.tabs.Tab): boolean {
  return Boolean(tab.url?.startsWith('http://') || tab.url?.startsWith('https://'));
}
