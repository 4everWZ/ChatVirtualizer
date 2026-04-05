import {
  isRuntimeMessage,
  type RuntimeMessage,
  type SessionStatsMessage
} from '@/shared/runtime-messages';

describe('runtime message guards', () => {
  test('accepts typed stats payloads', () => {
    const message: SessionStatsMessage = {
      type: 'session-stats',
      payload: {
        adapterConfidence: 0.91,
        mountedCount: 10,
        placeholderCount: 5,
        sessionId: 'session-1',
        totalRecords: 15
      }
    };

    expect(isRuntimeMessage(message)).toBe(true);
  });

  test('rejects unknown message types', () => {
    const message = {
      type: 'something-else',
      payload: {}
    } satisfies RuntimeMessage | { type: string; payload: object };

    expect(isRuntimeMessage(message)).toBe(false);
  });
});
