import type { PageAdapter, TurnBusySignal, TurnCandidate, TurnRole } from '@/shared/contracts';

const LIVE_TURN_SELECTORS = [
  'section[data-testid^="conversation-turn-"][data-turn][data-turn-id]',
  'section[data-testid^="conversation-turn-"][data-turn]'
].join(', ');

const LEGACY_TURN_SELECTORS = [
  '[data-turn-root]',
  '[data-message-author-role]',
  'article[data-message-author-role]',
  'div[data-message-author-role]'
].join(', ');

export const CHATGPT_TURN_SELECTORS = [
  LIVE_TURN_SELECTORS,
  LEGACY_TURN_SELECTORS
].join(', ');

const DIRECT_SCROLL_SELECTORS = ['[data-scroll-root]', '[data-ecv-scroll-container]', '[data-testid="conversation-turns"]'].join(', ');
const QUICK_JUMP_CONTAINER_SELECTOR = '.fixed.end-4.top-1\\/2.z-20.-translate-y-1\\/2';
const LOCATION_CHANGE_EVENT = 'ecv:locationchange';
const HISTORY_PATCH_STATE_KEY = '__ecvHistoryPatchState__';

interface HistoryPatchState {
  refCount: number;
  teardown: () => void;
}

export class ChatGptPageAdapter implements PageAdapter {
  constructor(private readonly rootDocument: Document = document) {}

  canHandlePage(): boolean {
    return this.getConfidence() >= 0.6;
  }

  getSessionId(): string {
    const match = globalThis.location.pathname.match(/\/c\/([^/]+)/);
    if (match?.[1]) {
      return match[1];
    }

    return globalThis.location.pathname.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown-session';
  }

  getScrollContainer(): HTMLElement | null {
    const threadRoot = this.rootDocument.querySelector<HTMLElement>('#thread');
    const main = this.rootDocument.querySelector<HTMLElement>('main#main, main');
    const firstTurn = this.rootDocument.querySelector<HTMLElement>(LIVE_TURN_SELECTORS);

    for (const anchor of [firstTurn, threadRoot, main]) {
      const container = anchor?.closest<HTMLElement>('[data-scroll-root]');
      if (container) {
        return container;
      }
    }

    const directCandidates = Array.from(this.rootDocument.querySelectorAll<HTMLElement>(DIRECT_SCROLL_SELECTORS));
    for (const candidate of directCandidates) {
      if (containsConversation(candidate)) {
        return candidate;
      }
    }

    if (!main) {
      return null;
    }

    const candidates = [main, ...Array.from(main.querySelectorAll<HTMLElement>('section, div'))];
    return candidates.find((candidate) => isScrollable(candidate) && containsConversation(candidate)) ?? null;
  }

  collectTurnCandidates(): TurnCandidate[] {
    const scrollContainer = this.getScrollContainer();
    if (!scrollContainer) {
      return [];
    }

    const candidates: TurnCandidate[] = [];

    const searchRoot = scrollContainer.querySelector<HTMLElement>('#thread') ?? scrollContainer;
    const elements = collectTurnRootElements(searchRoot);

    elements.forEach((element, index) => {
      const role = resolveRole(element);
      if (!role) {
        return;
      }

      const busySignal = resolveBusySignal(element);

      candidates.push({
        id: element.dataset.turnId ?? `${role}-${index}`,
        role,
        text: element.textContent?.trim() ?? '',
        element,
        busySignal,
        generating: busySignal !== 'none'
      });
    });

    return candidates;
  }

  observeSessionChanges(callback: () => void): () => void {
    let previousPath = globalThis.location.pathname;

    const onLocationChange = () => {
      if (globalThis.location.pathname !== previousPath) {
        previousPath = globalThis.location.pathname;
        callback();
      }
    };

    const releaseHistoryPatch = ensureHistoryChangeEvents();
    globalThis.addEventListener(LOCATION_CHANGE_EVENT, onLocationChange);

    return () => {
      globalThis.removeEventListener(LOCATION_CHANGE_EVENT, onLocationChange);
      releaseHistoryPatch();
    };
  }

  getConfidence(): number {
    const scrollContainer = this.getScrollContainer();
    const turnCount = this.collectTurnCandidatesInternal(scrollContainer).length;
    let confidence = 0;

    if (scrollContainer) {
      confidence += 0.4;
    }

    if (turnCount >= 2) {
      confidence += 0.4;
    }

    if (this.rootDocument.querySelector('main#main, #thread')) {
      confidence += 0.1;
    }

    if (globalThis.location.pathname.includes('/c/')) {
      confidence += 0.1;
    }

    return confidence;
  }

  getQuickJumpContainer(): HTMLElement | null {
    return this.rootDocument.querySelector<HTMLElement>(QUICK_JUMP_CONTAINER_SELECTOR);
  }

  extractQuickJumpText(target: EventTarget | null): string | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const item = target.closest<HTMLElement>('button, a, [role="button"], [data-quick-jump-item]');
    return item?.textContent?.replace(/\s+/g, ' ').trim() || null;
  }

  private collectTurnCandidatesInternal(scrollContainer: HTMLElement | null): HTMLElement[] {
    if (!scrollContainer) {
      return [];
    }

    const searchRoot = scrollContainer.querySelector<HTMLElement>('#thread') ?? scrollContainer;
    return collectTurnRootElements(searchRoot).filter((element) => Boolean(resolveRole(element)));
  }
}

function resolveBusySignal(element: HTMLElement): TurnBusySignal {
  if (element.getAttribute('aria-busy') === 'true') {
    return 'root-aria-busy';
  }

  if (element.querySelector('[data-writing-block]') !== null) {
    return 'writing-block';
  }

  if (element.querySelector('[aria-busy="true"]') !== null) {
    return 'descendant-aria-busy';
  }

  return 'none';
}

function resolveRole(element: HTMLElement): TurnRole | null {
  const turnRole = element.dataset.turn;
  if (turnRole === 'user' || turnRole === 'assistant' || turnRole === 'tool') {
    return turnRole;
  }

  const authorRole = element.dataset.messageAuthorRole;
  if (authorRole === 'user' || authorRole === 'assistant') {
    return authorRole;
  }

  if (element.dataset.turnRoot !== undefined && authorRole === undefined) {
    const fallback = element.getAttribute('data-role');
    if (fallback === 'user' || fallback === 'assistant' || fallback === 'tool') {
      return fallback;
    }
  }

  const ariaRole = element.getAttribute('aria-label')?.toLowerCase() ?? '';
  if (ariaRole.includes('assistant')) {
    return 'assistant';
  }
  if (ariaRole.includes('user')) {
    return 'user';
  }

  const headingLabel = element.querySelector('h4, h5, h6')?.textContent?.toLowerCase() ?? '';
  if (headingLabel.includes('chatgpt said')) {
    return 'assistant';
  }
  if (headingLabel.includes('you said')) {
    return 'user';
  }

  return null;
}

function isScrollable(element: HTMLElement): boolean {
  const style = globalThis.getComputedStyle(element);
  return style.overflowY === 'auto' || style.overflowY === 'scroll';
}

function containsConversation(element: HTMLElement): boolean {
  return element.querySelector(CHATGPT_TURN_SELECTORS) !== null;
}

function collectTurnRootElements(searchRoot: ParentNode): HTMLElement[] {
  const liveTurns = Array.from(searchRoot.querySelectorAll<HTMLElement>(LIVE_TURN_SELECTORS));
  if (liveTurns.length > 0) {
    return liveTurns;
  }

  return Array.from(searchRoot.querySelectorAll<HTMLElement>(LEGACY_TURN_SELECTORS)).filter(
    (element) => !hasAncestorMatching(element, LEGACY_TURN_SELECTORS) && !hasAncestorMatching(element, LIVE_TURN_SELECTORS)
  );
}

function hasAncestorMatching(element: HTMLElement, selector: string): boolean {
  let current = element.parentElement;
  while (current) {
    if (current.matches(selector)) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function ensureHistoryChangeEvents(): () => void {
  const state = getHistoryPatchState();
  if (state) {
    state.refCount += 1;
    return () => releaseHistoryPatch();
  }

  const originalPushState = globalThis.history.pushState.bind(globalThis.history);
  const originalReplaceState = globalThis.history.replaceState.bind(globalThis.history);
  const dispatch = () => globalThis.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));

  globalThis.history.pushState = ((...args) => {
    originalPushState(...args);
    dispatch();
  }) as History['pushState'];

  globalThis.history.replaceState = ((...args) => {
    originalReplaceState(...args);
    dispatch();
  }) as History['replaceState'];

  const onPopstate = () => dispatch();
  const onHashchange = () => dispatch();
  globalThis.addEventListener('popstate', onPopstate);
  globalThis.addEventListener('hashchange', onHashchange);

  setHistoryPatchState({
    refCount: 1,
    teardown: () => {
      globalThis.history.pushState = originalPushState;
      globalThis.history.replaceState = originalReplaceState;
      globalThis.removeEventListener('popstate', onPopstate);
      globalThis.removeEventListener('hashchange', onHashchange);
    }
  });

  return () => releaseHistoryPatch();
}

function releaseHistoryPatch(): void {
  const state = getHistoryPatchState();
  if (!state) {
    return;
  }

  state.refCount -= 1;
  if (state.refCount > 0) {
    return;
  }

  state.teardown();
  setHistoryPatchState(undefined);
}

function getHistoryPatchState(): HistoryPatchState | undefined {
  return (globalThis as typeof globalThis & { [HISTORY_PATCH_STATE_KEY]?: HistoryPatchState })[HISTORY_PATCH_STATE_KEY];
}

function setHistoryPatchState(state: HistoryPatchState | undefined): void {
  (globalThis as typeof globalThis & { [HISTORY_PATCH_STATE_KEY]?: HistoryPatchState })[HISTORY_PATCH_STATE_KEY] = state;
}
