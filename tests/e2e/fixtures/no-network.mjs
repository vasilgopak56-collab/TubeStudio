// Test-only preload: no credentials or real network are used by the isolated server.
import fs from 'node:fs/promises';
const log = process.env.TS_TEST_NETWORK_LOG;
if (!log) throw Error('Explicit test network log is required');
globalThis.fetch = async () => { await fs.appendFile(log, 'blocked external request\n'); throw Error('External request forbidden in local-only test'); };
