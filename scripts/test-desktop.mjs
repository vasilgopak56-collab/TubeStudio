// Explicit desktop-only manifest; historical mobile suites are intentionally excluded.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const names=JSON.parse(fs.readFileSync(new URL('../tests/desktop-manifest.json',import.meta.url),'utf8'));
const r=spawnSync(process.execPath,['--test','--test-concurrency=1',...names.map(n=>'tests/e2e/'+n)],{stdio:'inherit',env:{...process.env,TEST_ARTIFACTS_DIR:process.env.TEST_ARTIFACTS_DIR??path.join(os.tmpdir(),'tubestudio-desktop-artifacts')}});
process.exit(r.status??1);
