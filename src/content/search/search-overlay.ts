import type { SearchHit } from '@/shared/contracts';

interface SearchOverlayCallbacks {
  onQueryChange: (query: string) => void;
  onSelectHit: (hit: SearchHit) => void;
}

export class SearchOverlay {
  readonly shadowRoot: ShadowRoot;

  private readonly host: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly resultsContainer: HTMLDivElement;
  private readonly callbacks: SearchOverlayCallbacks;
  private visible = false;

  constructor(parent: HTMLElement, callbacks: SearchOverlayCallbacks) {
    this.callbacks = callbacks;
    this.host = document.createElement('div');
    this.host.style.display = 'none';
    this.host.className = 'ecv-search-overlay-host';
    parent.append(this.host);

    this.shadowRoot = this.host.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          position: fixed;
          top: 24px;
          right: 24px;
          width: 360px;
          max-height: 70vh;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          background: rgba(15, 23, 42, 0.95);
          color: white;
          border-radius: 16px;
          box-shadow: 0 20px 40px rgba(15, 23, 42, 0.35);
          font-family: ui-sans-serif, system-ui, sans-serif;
          z-index: 2147483647;
        }
        input, button {
          font: inherit;
        }
        input {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          background: rgba(15, 23, 42, 0.65);
          color: white;
        }
        .results {
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .result {
          text-align: left;
          padding: 10px 12px;
          border-radius: 10px;
          border: 0;
          background: rgba(30, 41, 59, 0.85);
          color: white;
          cursor: pointer;
        }
        .meta {
          display: block;
          margin-top: 4px;
          color: rgba(191, 219, 254, 0.9);
          font-size: 12px;
        }
        .toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
      </style>
      <div class="panel">
        <div class="toolbar">
          <strong>Session Search</strong>
          <button type="button" data-action="close">Close</button>
        </div>
        <input type="search" placeholder="Search current session" />
        <div class="results"></div>
      </div>
    `;

    const input = this.shadowRoot.querySelector<HTMLInputElement>('input[type="search"]');
    const resultsContainer = this.shadowRoot.querySelector<HTMLDivElement>('.results');
    const closeButton = this.shadowRoot.querySelector<HTMLButtonElement>('button[data-action="close"]');

    if (!input || !resultsContainer || !closeButton) {
      throw new Error('Failed to initialize search overlay');
    }

    this.input = input;
    this.resultsContainer = resultsContainer;

    this.input.addEventListener('input', () => {
      this.callbacks.onQueryChange(this.input.value);
    });

    closeButton.addEventListener('click', () => this.hide());
  }

  show(): void {
    this.host.style.display = 'block';
    this.visible = true;
    this.input.focus();
  }

  hide(): void {
    this.host.style.display = 'none';
    this.visible = false;
  }

  toggle(forceOpen?: boolean): void {
    if (forceOpen === true) {
      this.show();
      return;
    }

    if (forceOpen === false) {
      this.hide();
      return;
    }

    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  setResults(results: SearchHit[]): void {
    this.resultsContainer.replaceChildren();

    if (results.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = this.input.value ? 'No results' : 'Type to search the current session';
      this.resultsContainer.append(empty);
      return;
    }

    for (const hit of results) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result';
      button.dataset.recordId = hit.recordId;
      button.innerHTML = `
        <span>${escapeHtml(hit.snippet)}</span>
        <span class="meta">${hit.matchedIn} · score ${hit.score}</span>
      `;
      button.addEventListener('click', () => {
        this.callbacks.onSelectHit(hit);
      });
      this.resultsContainer.append(button);
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
