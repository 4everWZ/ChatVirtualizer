import type { SearchHit } from '@/shared/contracts';
import { SearchOverlay } from '@/content/search/search-overlay';

describe('search overlay', () => {
  test('renders results and emits selection events', () => {
    const selected: SearchHit[] = [];
    const queried: string[] = [];
    const overlay = new SearchOverlay(document.body, {
      onQueryChange: (query) => queried.push(query),
      onSelectHit: (hit) => selected.push(hit)
    });

    overlay.show();
    overlay.setResults([
      {
        recordId: 'record-1',
        score: 100,
        matchedIn: 'assistant',
        snippet: 'matching snippet'
      }
    ]);

    const input = overlay.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) {
      throw new Error('expected search input');
    }

    input.value = 'snippet';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const button = overlay.shadowRoot?.querySelector<HTMLButtonElement>('button[data-record-id="record-1"]');
    if (!button) {
      throw new Error('expected result button');
    }

    button.click();

    expect(queried).toContain('snippet');
    expect(selected[0]?.recordId).toBe('record-1');
    expect(overlay.isVisible()).toBe(true);
  });
});
