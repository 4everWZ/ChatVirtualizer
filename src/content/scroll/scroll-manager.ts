interface ScrollManagerOptions {
  onReachTop: () => Promise<void> | void;
  topThresholdPx: number;
}

export class ScrollManager {
  private readonly sentinel: HTMLDivElement;
  private observer?: IntersectionObserver;
  private armed = false;
  private busy = false;

  constructor(
    private readonly scrollContainer: HTMLElement,
    private readonly options: ScrollManagerOptions
  ) {
    this.sentinel = document.createElement('div');
    this.sentinel.dataset.ecvTopSentinel = 'true';
    this.sentinel.style.height = '1px';
    this.scrollContainer.prepend(this.sentinel);

    this.scrollContainer.addEventListener('scroll', this.handleScroll, {
      passive: true
    });

    if ('IntersectionObserver' in globalThis) {
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            void this.maybeTrigger();
          }
        },
        {
          root: this.scrollContainer,
          threshold: 0
        }
      );
      this.observer.observe(this.sentinel);
    }
  }

  disconnect(): void {
    this.scrollContainer.removeEventListener('scroll', this.handleScroll);
    this.observer?.disconnect();
    this.sentinel.remove();
  }

  private readonly handleScroll = (): void => {
    if (this.scrollContainer.scrollTop > this.options.topThresholdPx) {
      this.armed = true;
    }

    if (this.scrollContainer.scrollTop <= this.options.topThresholdPx) {
      void this.maybeTrigger();
    }
  };

  private async maybeTrigger(): Promise<void> {
    if (!this.armed || this.busy) {
      return;
    }

    this.busy = true;
    try {
      await this.options.onReachTop();
    } finally {
      this.busy = false;
    }
  }
}
