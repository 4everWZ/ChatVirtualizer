import { DEFAULT_CONFIG, mergeConfig } from '@/shared/config';
import type { ExtensionConfig } from '@/shared/contracts';

const STORAGE_KEY = 'ecv-config';

export class ConfigStore {
  async getConfig(): Promise<ExtensionConfig> {
    const stored = await this.readRaw();
    return mergeConfig(stored);
  }

  async updateConfig(overrides: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
    const next = mergeConfig({
      ...(await this.readRaw()),
      ...overrides
    });
    await this.writeRaw(next);
    return next;
  }

  async reset(): Promise<ExtensionConfig> {
    await this.writeRaw(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  private async readRaw(): Promise<Partial<ExtensionConfig> | undefined> {
    const chromeStorage = globalThis.chrome?.storage?.local;
    if (chromeStorage) {
      const result = await chromeStorage.get(STORAGE_KEY);
      return result[STORAGE_KEY] as Partial<ExtensionConfig> | undefined;
    }

    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<ExtensionConfig>) : undefined;
  }

  private async writeRaw(config: ExtensionConfig): Promise<void> {
    const chromeStorage = globalThis.chrome?.storage?.local;
    if (chromeStorage) {
      await chromeStorage.set({
        [STORAGE_KEY]: config
      });
      return;
    }

    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(config));
  }
}
