import type { TurnCandidate } from '@/shared/contracts';
import { buildQaRecordsFromTurns } from '@/content/records/record-engine';
import { vi } from 'vitest';

describe('record engine', () => {
  test('does not force synchronous layout measurement while building records', () => {
    const elements = [createTurnElement('Question 1'), createTurnElement('Answer 1'), createTurnElement('Question 2')];
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');

    try {
      const turns: TurnCandidate[] = [
        { id: 'u-1', role: 'user', text: 'Question 1', element: elements[0]! },
        { id: 'a-1', role: 'assistant', text: 'Answer 1', element: elements[1]! },
        { id: 'u-2', role: 'user', text: 'Question 2', element: elements[2]! }
      ];

      const records = buildQaRecordsFromTurns(turns, 'session-1');

      expect(records).toHaveLength(2);
      expect(rectSpy).not.toHaveBeenCalled();
      expect(records[0]?.height).toBeGreaterThan(0);
    } finally {
      rectSpy.mockRestore();
    }
  });
});

function createTurnElement(text: string): HTMLElement {
  const element = document.createElement('section');
  element.textContent = text;
  return element;
}
