// This acceptance fixture never forwards a request. Metadata and generation are forbidden.
import fs from 'node:fs';
globalThis.fetch=async()=>{fs.appendFileSync(process.env.TS_BUDGET_NETWORK,'blocked\n');throw Error('Provider network forbidden in local budget acceptance');};
