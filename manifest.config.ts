import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Edge Chat Virtualizer',
  description: 'Gemini-style on-demand history virtualization for long ChatGPT conversations.',
  version: '0.1.0',
  minimum_chrome_version: '120',
  permissions: ['storage', 'tabs', 'activeTab'],
  host_permissions: [
    'https://chat.openai.com/*',
    'https://chatgpt.com/*',
    'http://127.0.0.1/*',
    'http://localhost/*'
  ],
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module'
  },
  action: {
    default_title: 'Edge Chat Virtualizer',
    default_popup: 'src/popup/index.html'
  },
  options_page: 'src/options/index.html',
  content_scripts: [
    {
      matches: [
        'https://chat.openai.com/*',
        'https://chatgpt.com/*',
        'http://127.0.0.1/*',
        'http://localhost/*'
      ],
      js: ['src/content/bootstrap.ts'],
      run_at: 'document_idle'
    }
  ]
});
