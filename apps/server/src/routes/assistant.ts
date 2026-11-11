import {brainstormRoute} from './brainstorm.js';
import {AssistantSkillBranchAsk,AssistantSkillBranchSend,previewAssistantSkillBranch,createAssistantSkillBranch} from '../services/assistant.js';
import {ManualSkillAsk,ManualSkillSend,previewManualSkill,saveManualSkill} from '../services/assistant.js';
import {SkillArchiveAsk,SkillArchiveSend,previewSkillArchive,setSkillArchive} from '../services/assistant.js';
import {listAssistantIdeasContext} from '../services/assistantIdeasContext.js';
import {AssistantIdeasBranchAsk,AssistantIdeasBranchSend,previewAssistantIdeasBranch,createAssistantIdeasBranch} from '../services/assistant.js';
import {IdeasProjectAsk,IdeasProjectSend,previewIdeasProject,saveIdeasProject} from '../services/assistantIdeasProject.js';
import {WorkflowForkAsk,WorkflowForkSend,previewWorkflowFork,createWorkflowFork} from '../services/assistantWorkflow.js';
import {AssistantSourceBranchAsk,AssistantSourceBranchSend,previewAssistantSourceBranch,createAssistantSourceBranch} from '../services/assistant.js';
import {AssistantChannelAsk,AssistantChannelSend,previewAssistantChannel,reserveAssistantChannel,runAssistantChannel} from '../services/assistant.js';
import {listAssistantPromptContext} from '../services/assistantPromptContext.js';
import {AssistantPromptBranchAsk,AssistantPromptBranchSend,previewAssistantPromptBranch,createAssistantPromptBranch} from '../services/assistant.js';
import {PromptNotesListAsk,PromptNoteAsk,listPromptNotes,previewPromptNote} from '../services/assistantPromptNotes.js';
import {WorkflowBatchAsk,WorkflowBatchSend,previewWorkflowBatch,saveWorkflowBatch} from '../services/assistantWorkflowBatch.js';
import {WorkflowProjectAsk,WorkflowProjectSend,previewWorkflowProject,saveWorkflowProject} from '../services/assistantWorkflowProject.js';
import {WorkflowExportAsk,previewWorkflowExport} from '../services/assistantWorkflow.js';
import {listAssistantScripts} from '../services/assistantScriptContext.js';
import {AssistantScriptBranchAsk,AssistantScriptBranchSend,previewAssistantScriptBranch,createAssistantScriptBranch} from '../services/assistant.js';
import {AssistantDocumentBranchAsk,AssistantDocumentBranchSend,previewAssistantDocumentBranch,createAssistantDocumentBranch} from '../services/assistant.js';
import {AssistantSceneBranchAsk,AssistantSceneBranchSend,previewAssistantSceneBranch,createAssistantSceneBranch} from '../services/assistant.js';
import {PromptRevisionAsk,PromptRevisionSend,previewPromptRevision,savePromptRevision,PromptBatchAsk,PromptBatchSend,previewPromptBatch,savePromptBatch} from '../services/storyboardPromptRevision.js';
import {StoryboardExcerptAsk,listAssistantStoryboards,previewAssistantStoryboardExcerpt} from '../services/assistantStoryboardContext.js';
import {SavedStoryboardAsk,previewSavedStoryboardInput} from '../services/storyboard.js';
import {StoryboardSourceAsk,previewStoryboardSource} from '../services/assistantStoryboard.js';
import {previewAssistantDocument} from '../services/assistantDocuments.js';
import {VoiceFxAsk,VoiceFxSend,previewVoiceFx,processVoiceFx,previewVoiceFxAttachment,attachVoiceFx} from '../services/assistantVoiceFx.js';
import {SpeechConnectionInput,createSpeechConnection,listSpeechConnections,SpeechRemovalAsk,SpeechRemovalSend,previewSpeechRemoval,removeSpeechConnection} from '../services/ttsConnections.js';
import {VoiceAssemblyAsk,VoiceAssemblySend,previewVoiceAssembly,assembleVoice,previewVoiceAssemblyAttachment,attachVoiceAssembly} from '../services/assistantVoiceExecution.js';
import {VoicePartAsk,VoicePartSend,voicePreparations,voiceExecutionState,previewVoicePart,reserveVoicePart,runVoicePart,recoverVoicePart,previewVoiceAttachment,attachVoicePart} from '../services/assistantVoiceExecution.js';
import {VoicePreparationAsk,VoicePreparationSend,assistantVoiceScripts,previewAssistantVoice,saveAssistantVoice} from '../services/assistantVoice.js';
import {SkillVersionAsk,SkillVersionSend,assistantSkillHistory,previewAssistantSkillVersion,saveAssistantSkillVersion} from '../services/assistant.js';
import {assistantPlanReview} from '../services/assistant.js';
import {WorkflowSkillAsk,WorkflowSkillSend,previewWorkflowSkill,saveWorkflowSkill,WorkflowEditAsk,WorkflowEditSend,previewWorkflowEdit,editWorkflow,WorkflowDraft,WorkflowCreate,WorkflowStepAsk,WorkflowStepSend,WorkflowConfirm,WorkflowRetry,WorkflowBind,listWorkflows,loadWorkflow,previewWorkflow,createWorkflow,previewWorkflowStep,reserveWorkflowStep,runWorkflowStep,acceptWorkflowStep,recoverWorkflow,retryWorkflow,bindWorkflow} from '../services/assistantWorkflow.js';
import {AssistantAppendAsk,AssistantAppendSend,previewAssistantAppend,appendAssistantResult} from '../services/assistant.js';
import {ConnectionInput,createModelConnection,listModelConnections,ConnectionRemovalAsk,ConnectionRemovalSend,previewConnectionRemoval,removeModelConnection} from '../services/modelConnections.js';
import {assistantHelpAnswer,assistantQuote,runAssistantAction} from '../services/assistantActions.js';
import {assistantMaxTokens} from '../services/assistant.js';
import {reservePublishTexts,runPublishTextsAction} from '../services/assistantPublishTexts.js';
import {reserveFactCheck,runFactCheckAction} from '../services/assistantFactCheck.js';
import {reserveRadar,runRadarAction} from '../services/assistantRadar.js';
import {reserveScriptWrite,runScriptWriteAction} from '../services/assistantScriptWrite.js';
import {reserveMontageRender,reserveShortsBuild,runMontageRenderAction,runShortsBuildAction} from '../services/assistantStudioBuild.js';
import {linkJobToChannel} from '../services/studio/channels.js';
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {z} from 'zod';
import {ApiError,fail,ok} from '../lib/errors.js';
import {startJob} from '../lib/jobs.js';
import {AssistantRebindAsk,AssistantRebindSend,previewAssistantRebind,rebindAssistant,AssistantSourceAsk,AssistantSourceSend,previewAssistantSource,reserveAssistantSource,runAssistantSource,AssistantCreate,AssistantAsk,AssistantSend,AssistantProject,AssistantSaveSkill,assistantState,createAssistant,loadAssistant,previewAssistant,reserveAssistant,runAssistant,saveAssistantSkill,assistantProjectPreview,createAssistantProject} from '../services/assistant.js';
export const assistantRoute=new Hono();
assistantRoute.use('/assistant/*',bodyLimit({maxSize:320000,onError:c=>fail(c,new ApiError('VALIDATION','Материалы помощника слишком велики.',413))}));
assistantRoute.use('/assistant/*',async(c,next)=>{const origin=c.req.header('origin');if(origin&&origin!==new URL(c.req.url).origin)return fail(c,new ApiError('UNAUTHORIZED','Запрос помощника разрешён только из исходного приложения.',403));return next();});
assistantRoute.route('/',brainstormRoute);
async function body(c:{req:{json:()=>Promise<unknown>}}){try{return await c.req.json();}catch{throw new ApiError('VALIDATION','Нужен корректный JSON.');}}
assistantRoute.get('/assistant/state',async c=>{try{return ok(c,await assistantState());}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/conversations',async c=>{try{return ok(c,await createAssistant(AssistantCreate.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.get('/assistant/conversations/:id',async c=>{try{return ok(c,await loadAssistant(z.string().uuid().parse(c.req.param('id'))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/preview',async c=>{try{const p=await previewAssistant(AssistantAsk.parse(await body(c)));return ok(c,{...p,quoteUsd:await assistantQuote(p.selection,p.characters,assistantMaxTokens(p.input))});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/help',async c=>{try{return ok(c,assistantHelpAnswer(await body(c)));}catch(e){return fail(c,e);}});
/** Платное действие: запись попытки, затем задача, внутри которой окно цены разрешает один запрос. */
assistantRoute.post('/assistant/actions/publish-texts',async c=>{try{const a=await reservePublishTexts(await body(c));const jobId=startJob(ctx=>runPublishTextsAction(a,ctx));await linkJobToChannel(jobId,a.channelId,'publish-seo',a.projectId).catch(()=>{});return ok(c,{jobId});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/actions/fact-check',async c=>{try{const a=await reserveFactCheck(await body(c));const jobId=startJob(ctx=>runFactCheckAction(a,ctx));await linkJobToChannel(jobId,a.channelId,'factcheck',a.projectId).catch(()=>{});return ok(c,{jobId});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/actions/radar',async c=>{try{const a=await reserveRadar(await body(c));const jobId=startJob(ctx=>runRadarAction(a,ctx));await linkJobToChannel(jobId,a.channelId,'radar').catch(()=>{});return ok(c,{jobId});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/actions/script-write',async c=>{try{const a=await reserveScriptWrite(await body(c));const jobId=startJob(ctx=>runScriptWriteAction(a,ctx));await linkJobToChannel(jobId,a.channelId,'script',a.projectId).catch(()=>{});return ok(c,{jobId});}catch(e){return fail(c,e);}});
/** Бесплатные сборки на этом компьютере: те же, что по кнопкам на страницах «Монтаж» и «Shorts». */
assistantRoute.post('/assistant/actions/montage-render',async c=>{try{const a=await reserveMontageRender(await body(c));const jobId=startJob(ctx=>runMontageRenderAction(a,ctx));await linkJobToChannel(jobId,a.channelId,'montage-render',a.projectId).catch(()=>{});return ok(c,{jobId});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/actions/shorts-build',async c=>{try{const a=await reserveShortsBuild(await body(c));const jobId=startJob(ctx=>runShortsBuildAction(a,ctx));await linkJobToChannel(jobId,a.channelId,'shorts-build',a.projectId).catch(()=>{});return ok(c,{jobId});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/actions',async c=>{try{return ok(c,await runAssistantAction(await body(c)));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/ask',async c=>{try{const p=await reserveAssistant(AssistantSend.parse(await body(c)));return ok(c,{jobId:startJob(ctx=>runAssistant(p,ctx))});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/manual-skill-preview',async c=>{try{return ok(c,await previewManualSkill(ManualSkillAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/manual-skills',async c=>{try{return ok(c,await saveManualSkill(ManualSkillSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/skills',async c=>{try{return ok(c,await saveAssistantSkill(AssistantSaveSkill.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/project-preview',async c=>{try{const d=z.object({runId:z.string().uuid(),title:z.string()}).strict().parse(await body(c));return ok(c,await assistantProjectPreview(d.runId,d.title));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/projects',async c=>{try{return ok(c,await createAssistantProject(AssistantProject.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/channel-preview',async c=>{try{return ok(c,await previewAssistantChannel(AssistantChannelAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/channel-uploads',async c=>{try{const p=await reserveAssistantChannel(AssistantChannelSend.parse(await body(c)));return ok(c,{jobId:startJob(ctx=>runAssistantChannel(p,ctx))});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/source-preview',async c=>{try{return ok(c,await previewAssistantSource(AssistantSourceAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/sources',async c=>{try{const p=await reserveAssistantSource(AssistantSourceSend.parse(await body(c)));return ok(c,{jobId:startJob(ctx=>runAssistantSource(p,ctx))});}catch(e){return fail(c,e);}});

assistantRoute.get('/assistant/connections',async c=>{try{return ok(c,await listModelConnections());}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/connections',async c=>{try{return ok(c,await createModelConnection(ConnectionInput.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/connection-removal-preview',async c=>{try{return ok(c,await previewConnectionRemoval(ConnectionRemovalAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/connection-removal',async c=>{try{return ok(c,await removeModelConnection(ConnectionRemovalSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/rebind-preview',async c=>{try{return ok(c,await previewAssistantRebind(AssistantRebindAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/rebind',async c=>{try{return ok(c,await rebindAssistant(AssistantRebindSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/ideas-project-preview',async c=>{try{return ok(c,await previewIdeasProject(IdeasProjectAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/ideas-project',async c=>{try{return ok(c,await saveIdeasProject(IdeasProjectSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/append-preview',async c=>{try{return ok(c,await previewAssistantAppend(AssistantAppendAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/append',async c=>{try{return ok(c,await appendAssistantResult(AssistantAppendSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.get('/assistant/workflows',async c=>{try{return ok(c,await listWorkflows(z.string().uuid().parse(c.req.query('rootId'))));}catch(e){return fail(c,e);}});
assistantRoute.get('/assistant/workflows/:id',async c=>{try{return ok(c,await loadWorkflow(z.string().uuid().parse(c.req.param('id'))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-batch-preview',async c=>{try{return ok(c,await previewWorkflowBatch(WorkflowBatchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-batch',async c=>{try{return ok(c,await saveWorkflowBatch(WorkflowBatchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-project-preview',async c=>{try{return ok(c,await previewWorkflowProject(WorkflowProjectAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-project',async c=>{try{return ok(c,await saveWorkflowProject(WorkflowProjectSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-export-preview',async c=>{try{return ok(c,await previewWorkflowExport(WorkflowExportAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-preview',async c=>{try{return ok(c,await previewWorkflow(WorkflowDraft.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflows',async c=>{try{return ok(c,await createWorkflow(WorkflowCreate.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-step-preview',async c=>{try{return ok(c,await previewWorkflowStep(WorkflowStepAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-accept',async c=>{try{return ok(c,await acceptWorkflowStep(WorkflowConfirm.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-recover',async c=>{try{return ok(c,await recoverWorkflow(WorkflowConfirm.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-retry',async c=>{try{return ok(c,await retryWorkflow(WorkflowRetry.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-bind',async c=>{try{return ok(c,await bindWorkflow(WorkflowBind.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-step',async c=>{try{const p=await reserveWorkflowStep(WorkflowStepSend.parse(await body(c)));return ok(c,{jobId:startJob(ctx=>runWorkflowStep(p,ctx))});}catch(e){return fail(c,e);}});

assistantRoute.get('/assistant/plan-review/:id',async c=>{try{return ok(c,await assistantPlanReview(z.string().uuid().parse(c.req.param('id'))));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/workflow-fork-preview',async c=>{try{return ok(c,await previewWorkflowFork(WorkflowForkAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-fork',async c=>{try{return ok(c,await createWorkflowFork(WorkflowForkSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/workflow-edit-preview',async c=>{try{return ok(c,await previewWorkflowEdit(WorkflowEditAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-edit',async c=>{try{return ok(c,await editWorkflow(WorkflowEditSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/workflow-skill-preview',async c=>{try{return ok(c,await previewWorkflowSkill(WorkflowSkillAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/workflow-skills',async c=>{try{return ok(c,await saveWorkflowSkill(WorkflowSkillSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.get('/assistant/skills/:id/history',async c=>{try{return ok(c,await assistantSkillHistory(z.string().uuid().parse(c.req.param('id'))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/skill-archive-preview',async c=>{try{return ok(c,await previewSkillArchive(SkillArchiveAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/skill-archive',async c=>{try{return ok(c,await setSkillArchive(SkillArchiveSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/skill-version-preview',async c=>{try{return ok(c,await previewAssistantSkillVersion(SkillVersionAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/skill-versions',async c=>{try{return ok(c,await saveAssistantSkillVersion(SkillVersionSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.get('/assistant/project-ideas/:id',async c=>{try{return ok(c,await listAssistantIdeasContext(c.req.param('id')));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/ideas-branch-preview',async c=>{try{return ok(c,await previewAssistantIdeasBranch(AssistantIdeasBranchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/ideas-branches',async c=>{try{return ok(c,await createAssistantIdeasBranch(AssistantIdeasBranchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.get('/assistant/project-prompts/:id',async c=>{try{return ok(c,await listAssistantPromptContext(c.req.param('id')));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/prompt-branch-preview',async c=>{try{return ok(c,await previewAssistantPromptBranch(AssistantPromptBranchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/prompt-branches',async c=>{try{return ok(c,await createAssistantPromptBranch(AssistantPromptBranchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.get('/assistant/scripts/:id',async c=>{try{return ok(c,await listAssistantScripts(c.req.param('id')));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/script-branch-preview',async c=>{try{return ok(c,await previewAssistantScriptBranch(AssistantScriptBranchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/script-branches',async c=>{try{return ok(c,await createAssistantScriptBranch(AssistantScriptBranchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.get('/assistant/storyboards/:id',async c=>{try{return ok(c,await listAssistantStoryboards(c.req.param('id')));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/storyboard-excerpt-preview',async c=>{try{return ok(c,await previewAssistantStoryboardExcerpt(StoryboardExcerptAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/skill-branch-preview',async c=>{try{return ok(c,await previewAssistantSkillBranch(AssistantSkillBranchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/skill-branches',async c=>{try{return ok(c,await createAssistantSkillBranch(AssistantSkillBranchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/source-branch-preview',async c=>{try{return ok(c,await previewAssistantSourceBranch(AssistantSourceBranchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/source-branches',async c=>{try{return ok(c,await createAssistantSourceBranch(AssistantSourceBranchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/document-branch-preview',async c=>{try{return ok(c,await previewAssistantDocumentBranch(AssistantDocumentBranchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/document-branches',async c=>{try{return ok(c,await createAssistantDocumentBranch(AssistantDocumentBranchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/scene-branch-preview',async c=>{try{return ok(c,await previewAssistantSceneBranch(AssistantSceneBranchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/scene-branches',async c=>{try{return ok(c,await createAssistantSceneBranch(AssistantSceneBranchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/storyboard-prompt-batch-preview',async c=>{try{return ok(c,await previewPromptBatch(PromptBatchAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/storyboard-prompt-batch',async c=>{try{return ok(c,await savePromptBatch(PromptBatchSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/prompt-notes',async c=>{try{return ok(c,await listPromptNotes(PromptNotesListAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/prompt-note-preview',async c=>{try{return ok(c,await previewPromptNote(PromptNoteAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/storyboard-prompt-revision-preview',async c=>{try{return ok(c,await previewPromptRevision(PromptRevisionAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/storyboard-prompt-revision',async c=>{try{return ok(c,await savePromptRevision(PromptRevisionSend.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/storyboard-saved-preview',async c=>{try{return ok(c,await previewSavedStoryboardInput(SavedStoryboardAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/storyboard-source-preview',async c=>{try{return ok(c,await previewStoryboardSource(StoryboardSourceAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.get('/assistant/voice-scripts/:id',async c=>{try{return ok(c,await assistantVoiceScripts(c.req.param('id')));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-preview',async c=>{try{return ok(c,await previewAssistantVoice(VoicePreparationAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-preparations',async c=>{try{return ok(c,await saveAssistantVoice(VoicePreparationSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.get('/assistant/voice-preparations/:projectId',async c=>{try{return ok(c,await voicePreparations(c.req.param('projectId')));}catch(e){return fail(c,e);}});
assistantRoute.get('/assistant/voice-state/:projectId/:preparationId',async c=>{try{return ok(c,await voiceExecutionState(c.req.param('projectId'),c.req.param('preparationId')));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-part-preview',async c=>{try{return ok(c,await previewVoicePart(VoicePartAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-part',async c=>{try{const a=await reserveVoicePart(VoicePartSend.parse(await body(c)));return ok(c,{jobId:startJob(ctx=>runVoicePart(a,ctx))});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-part-recover',async c=>{try{return ok(c,await recoverVoicePart(VoicePartAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-attach-preview',async c=>{try{return ok(c,await previewVoiceAttachment(VoicePartAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-attach',async c=>{try{return ok(c,await attachVoicePart(VoicePartSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/voice-assembly-preview',async c=>{try{return ok(c,await previewVoiceAssembly(VoiceAssemblyAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-assembly',async c=>{try{const d=VoiceAssemblySend.parse(await body(c));return ok(c,{jobId:startJob(ctx=>assembleVoice(d,ctx))});}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-assembly-attach-preview',async c=>{try{return ok(c,await previewVoiceAssemblyAttachment(VoiceAssemblyAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/voice-assembly-attach',async c=>{try{return ok(c,await attachVoiceAssembly(VoiceAssemblySend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.get('/assistant/tts-connections',async c=>{try{return ok(c,await listSpeechConnections());}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/tts-connections',async c=>{try{return ok(c,await createSpeechConnection(SpeechConnectionInput.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/tts-removal-preview',async c=>{try{return ok(c,await previewSpeechRemoval(SpeechRemovalAsk.parse(await body(c))));}catch(e){return fail(c,e);}});
assistantRoute.post('/assistant/tts-removal',async c=>{try{return ok(c,await removeSpeechConnection(SpeechRemovalSend.parse(await body(c))));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/voice-fx-preview',async c=>{try{const d=VoiceFxAsk.parse(await body(c));return ok(c,await previewVoiceFx(d));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/voice-fx',async c=>{try{const d=VoiceFxSend.parse(await body(c));return ok(c,{jobId:startJob(ctx=>processVoiceFx(d,ctx))});}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/voice-fx-attach-preview',async c=>{try{const d=VoiceFxAsk.parse(await body(c));return ok(c,await previewVoiceFxAttachment(d));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/voice-fx-attach',async c=>{try{const d=VoiceFxSend.parse(await body(c));return ok(c,await attachVoiceFx(d));}catch(e){return fail(c,e);}});

assistantRoute.post('/assistant/document-preview',async c=>{try{return ok(c,previewAssistantDocument(await body(c)));}catch(e){return fail(c,e);}});
