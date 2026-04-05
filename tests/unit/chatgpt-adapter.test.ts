import { ChatGptPageAdapter } from '@/content/adapters/chatgpt/chatgpt-adapter';
import { vi } from 'vitest';

describe('chatgpt page adapter', () => {
  test('observes session changes without interval polling', async () => {
    window.history.replaceState({}, '', '/c/session-a');

    const callback = vi.fn();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const adapter = new ChatGptPageAdapter(document);

    try {
      const cleanup = adapter.observeSessionChanges(callback);

      expect(setIntervalSpy).not.toHaveBeenCalled();

      window.history.pushState({}, '', '/c/session-b');

      await vi.waitFor(() => {
        expect(callback).toHaveBeenCalledTimes(1);
      });

      cleanup();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});
