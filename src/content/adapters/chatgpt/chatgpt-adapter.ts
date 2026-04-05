import type { PageAdapter, TurnCandidate, TurnRole } from '@/shared/contracts';

const TURN_SELECTORS = [
  '[data-turn-root]',
  '[data-message-author-role]',
  'article[data-message-author-role]',
  'div[data-message-author-role]'
].join(', ');

const SCROLL_SELECTORS = [
  '[data-ecv-scroll-container]',
  '[aria-label="Chat history"]',
  '[data-testid="conversation-turns"]'
].join(', ');

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
    const direct = this.rootDocument.querySelector<HTMLElement>(SCROLL_SELECTORS);
    if (direct) {
      return direct;
    }

    const main = this.rootDocument.querySelector('main');
    if (!main) {
      return null;
    }

    const candidates = Array.from(main.querySelectorAll<HTMLElement>('section, div'));
    return candidates.find((candidate) => isScrollable(candidate)) ?? null;
  }

  collectTurnCandidates(): TurnCandidate[] {
    const scrollContainer = this.getScrollContainer();
    if (!scrollContainer) {
      return [];
    }

    const candidates: TurnCandidate[] = [];

    Array.from(scrollContainer.querySelectorAll<HTMLElement>(TURN_SELECTORS)).forEach((element, index) => {
      const role = resolveRole(element);
      if (!role) {
        return;
      }

      candidates.push({
        id: element.dataset.turnId ?? `${role}-${index}`,
        role,
        text: element.textContent?.trim() ?? '',
        element,
        generating: element.dataset.generating === 'true' || element.getAttribute('aria-busy') === 'true'
      });
    });

    return candidates;
  }

  observeSessionChanges(callback: () => void): () => void {
    let previousPath = globalThis.location.pathname;
    const interval = globalThis.setInterval(() => {
      if (globalThis.location.pathname !== previousPath) {
        previousPath = globalThis.location.pathname;
        callback();
      }
    }, 500);

    const onPopstate = () => {
      previousPath = globalThis.location.pathname;
      callback();
    };

    globalThis.addEventListener('popstate', onPopstate);
    return () => {
      globalThis.clearInterval(interval);
      globalThis.removeEventListener('popstate', onPopstate);
    };
  }

  getConfidence(): number {
    const scrollContainer = this.getScrollContainer();
    const turnCount = this.collectTurnCandidatesInternal(scrollContainer).length;
    let confidence = 0;

    if (scrollContainer) {
      confidence += 0.5;
    }

    if (turnCount >= 2) {
      confidence += 0.4;
    }

    if (globalThis.location.pathname.includes('/c/')) {
      confidence += 0.1;
    }

    return confidence;
  }

  private collectTurnCandidatesInternal(scrollContainer: HTMLElement | null): HTMLElement[] {
    if (!scrollContainer) {
      return [];
    }

    return Array.from(scrollContainer.querySelectorAll<HTMLElement>(TURN_SELECTORS)).filter((element) => Boolean(resolveRole(element)));
  }
}

function resolveRole(element: HTMLElement): TurnRole | null {
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

  return null;
}

function isScrollable(element: HTMLElement): boolean {
  const style = globalThis.getComputedStyle(element);
  return style.overflowY === 'auto' || style.overflowY === 'scroll';
}
