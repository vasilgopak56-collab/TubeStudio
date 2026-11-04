// Synthetic hanging job: no provider and no network. Test-only preload.
import {startJob} from '../../../apps/server/dist/lib/jobs.js';
startJob(async()=>new Promise(()=>{}));
