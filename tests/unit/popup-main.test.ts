import { vi } from 'vitest';

describe('popup main', () => {
  test('renders config and stats even when runtime config lookup fails', async () => {
    document.body.innerHTML = `
      <main class="popup">
        <label><input id="enableVirtualization" type="checkbox" /> Enable virtualization</label>
        <dl class="stats">
          <div><dt>Session</dt><dd id="sessionId">Unknown</dd></div>
          <div><dt>Total</dt><dd id="totalRecords">0</dd></div>
          <div><dt>Mounted</dt><dd id="mountedCount">0</dd></div>
          <div><dt>Collapsed</dt><dd id="collapsedGroupCount">0</dd></div>
        </dl>
      </main>
    `;

    vi.resetModules();

    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn(async (message: { type: string }) => {
          if (message.type === 'get-config') {
            throw new Error('background unavailable');
          }

          if (message.type === 'get-active-session-stats') {
            return undefined;
          }

          return undefined;
        })
      },
      storage: {
        local: {
          get: vi.fn(async () => ({
            'ecv-config': undefined
          })),
          set: vi.fn(async () => undefined)
        }
      },
      tabs: {
        query: vi.fn(async () => [
          {
            id: 7,
            url: 'https://chatgpt.com/c/session-1',
            active: true,
            lastAccessed: Date.now()
          }
        ]),
        sendMessage: vi.fn(async () => ({
          adapterConfidence: 0.9,
          collapsedGroupCount: 2,
          mountedCount: 10,
          sessionId: 'session-1',
          totalRecords: 12
        }))
      }
    } as unknown as typeof chrome;

    await import('@/popup/main');

    await vi.waitFor(() => {
      expect(document.querySelector('#sessionId')?.textContent).toBe('session-1');
      expect(document.querySelector('#mountedCount')?.textContent).toBe('10');
      expect((document.querySelector('#enableVirtualization') as HTMLInputElement).checked).toBe(true);
    });
  });
});
