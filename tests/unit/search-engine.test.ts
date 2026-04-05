import type { QARecord } from '@/shared/contracts';
import { searchRecords } from '@/content/search/search-engine';

const records: QARecord[] = [
  {
    id: 'record-1',
    index: 1,
    sessionId: 'session-1',
    userTurnIds: ['u-1'],
    assistantTurnIds: ['a-1'],
    textUser: 'How do I serialize snapshots?',
    textAssistant: 'Use a sanitized HTML snapshot plus normalized text.',
    textCombined: 'How do I serialize snapshots? Use a sanitized HTML snapshot plus normalized text.',
    height: 100,
    mounted: false,
    stable: true,
    generating: false
  },
  {
    id: 'record-2',
    index: 2,
    sessionId: 'session-1',
    userTurnIds: ['u-2'],
    assistantTurnIds: ['a-2'],
    textUser: 'What about code blocks?',
    textAssistant: 'Preserve code blocks in search text and snapshots.',
    textCombined: 'What about code blocks? Preserve code blocks in search text and snapshots.',
    height: 100,
    mounted: true,
    stable: true,
    generating: false
  }
];

describe('search engine', () => {
  test('prefers exact phrase matches and returns snippets', () => {
    const hits = searchRecords(records, 'code blocks');

    expect(hits[0]?.recordId).toBe('record-2');
    expect(hits[0]?.matchedIn).toBe('assistant');
    expect(hits[0]?.snippet).toContain('code blocks');
  });
});
