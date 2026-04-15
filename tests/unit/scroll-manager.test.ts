import { ScrollManager } from '@/content/scroll/scroll-manager';
import { vi } from 'vitest';

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  private readonly callback: ObserverCallback;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  disconnect(): void {
    return undefined;
  }

  observe(): void {
    return undefined;
  }

  trigger(isIntersecting: boolean): void {
    this.callback([{ isIntersecting }]);
  }
}

describe('scroll manager', () => {
  const originalIntersectionObserver = globalThis.IntersectionObserver;

  beforeEach(() => {
    MockIntersectionObserver.instances = [];
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: MockIntersectionObserver
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: originalIntersectionObserver
    });
    document.body.innerHTML = '';
  });

  test('does not trigger top restore from sentinel intersection until scrollTop is within threshold', async () => {
    const scrollContainer = document.createElement('div');
    document.body.append(scrollContainer);

    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0
    });

    const onReachTop = vi.fn();
    const manager = new ScrollManager(scrollContainer, {
      onReachTop,
      topThresholdPx: 24
    });

    try {
      scrollContainer.scrollTop = 400;
      scrollContainer.dispatchEvent(new Event('scroll'));

      const observer = MockIntersectionObserver.instances[0];
      if (!observer) {
        throw new Error('expected intersection observer instance');
      }

      observer.trigger(true);

      await Promise.resolve();

      expect(onReachTop).not.toHaveBeenCalled();

      scrollContainer.scrollTop = 24;
      observer.trigger(true);

      await vi.waitFor(() => {
        expect(onReachTop).toHaveBeenCalledTimes(1);
      });
    } finally {
      manager.disconnect();
    }
  });
});
