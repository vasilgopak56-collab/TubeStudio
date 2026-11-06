import {checkCancelled,taskContext} from '../../lib/taskContext.js';
import {assertChannelBudget,linkJobToChannel} from './channels.js';

/** Attribute each paid job before dispatch; a failed journal write blocks the call. */
export async function registerBrainstormSpend(channelId:string,kind:string){
 checkCancelled();
 const jobId=taskContext()?.jobId;
 if(jobId) await linkJobToChannel(jobId,channelId,kind);
 checkCancelled();
 await assertChannelBudget(channelId);
}
