import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfigService } from '../config/app-config.service.js';
import { buildLoggerParams, prettyTransportAvailable } from './logging.js';

const config = (production: boolean) =>
  ({
    isProduction: production,
    get: () => undefined,
  }) as unknown as AppConfigService;

describe('logging transport', () => {
  let bare: string;
  beforeAll(() => {
    bare = mkdtempSync(join(tmpdir(), 'codify-logging-'));
  });
  afterAll(() => rmSync(bare, { recursive: true, force: true }));

  it('finds pino-pretty in the workspace and not in a bare directory', () => {
    expect(prettyTransportAvailable()).toBe(true);
    expect(prettyTransportAvailable(bare)).toBe(false);
  });

  it('uses pino-pretty in development only when it is installed', () => {
    const transport = (p: ReturnType<typeof buildLoggerParams>) =>
      (p.pinoHttp as { transport?: { target: string } }).transport;
    expect(transport(buildLoggerParams(config(false)))?.target).toBe(
      'pino-pretty',
    );
    expect(transport(buildLoggerParams(config(true)))).toBeUndefined();

    const cwd = process.cwd();
    process.chdir(bare);
    try {
      expect(transport(buildLoggerParams(config(false)))).toBeUndefined();
    } finally {
      process.chdir(cwd);
    }
  });
});
