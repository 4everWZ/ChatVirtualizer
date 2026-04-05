import 'fake-indexeddb/auto';

Object.defineProperty(window, 'scrollTo', {
  value: () => undefined,
  writable: true
});
