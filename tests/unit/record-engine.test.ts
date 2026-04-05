import { buildQaRecordsFromTurns, type TurnCandidate } from '@/content/records/record-engine';

describe('record engine', () => {
  test('groups user, tool, and assistant turns into logical qa records', () => {
    const turns: TurnCandidate[] = [
      {
        id: 'u-1',
        role: 'user',
        text: 'Show me the implementation plan',
        element: document.createElement('article')
      },
      {
        id: 'tool-1',
        role: 'tool',
        text: 'Tool call: fetch docs',
        element: document.createElement('article')
      },
      {
        id: 'a-1',
        role: 'assistant',
        text: 'Here is the plan.',
        element: document.createElement('article')
      },
      {
        id: 'u-2',
        role: 'user',
        text: 'And the tests?',
        element: document.createElement('article')
      }
    ];

    const records = buildQaRecordsFromTurns(turns, 'session-1');

    expect(records).toHaveLength(2);
    expect(records[0]?.userTurnIds).toEqual(['u-1']);
    expect(records[0]?.assistantTurnIds).toEqual(['tool-1', 'a-1']);
    expect(records[0]?.textCombined).toContain('Tool call');
    expect(records[1]?.textUser).toContain('And the tests?');
    expect(records[1]?.stable).toBe(false);
  });

  test('marks a trailing streaming assistant response as generating', () => {
    const turns: TurnCandidate[] = [
      {
        id: 'u-1',
        role: 'user',
        text: 'What changed?',
        element: document.createElement('article')
      },
      {
        id: 'a-1',
        role: 'assistant',
        text: 'Still generating',
        generating: true,
        element: document.createElement('article')
      }
    ];

    const records = buildQaRecordsFromTurns(turns, 'session-2');

    expect(records).toHaveLength(1);
    expect(records[0]?.generating).toBe(true);
    expect(records[0]?.stable).toBe(false);
  });
});
