import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadFixtureHtml(name: string): string {
  return readFileSync(resolve('tests', 'fixtures', 'pages', name), 'utf8');
}

export function installFixtureDom(name: string, url: string): void {
  const html = loadFixtureHtml(name);
  document.documentElement.innerHTML = html;
  const parsed = new URL(url);
  window.history.replaceState({}, '', `${parsed.pathname}${parsed.search}${parsed.hash}`);
}
