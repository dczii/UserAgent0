import fs from 'fs';
import path from 'path';
import os from 'os';
import type { GlobalConfig } from './types';

const CONFIG_PATH = path.join(os.homedir(), '.useragent0', 'config.json');

const DEFAULTS: GlobalConfig = {
  default_model: 'claude-sonnet-4-6',
  default_provider: 'anthropic',
  server_port: 3000,
};

export function readGlobalConfig(): GlobalConfig {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeGlobalConfig(config: Partial<GlobalConfig>): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const current = readGlobalConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
}

export function setConfigKey(key: string, value: string): void {
  const config = readGlobalConfig();
  (config as unknown as Record<string, unknown>)[key] = value;
  writeGlobalConfig(config);
}

export function getApiKey(): string | undefined {
  const config = readGlobalConfig();
  return config.anthropic_api_key;
}
