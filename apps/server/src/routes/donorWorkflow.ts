import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError, ok, fail } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { Work, status, dnaKey, topicKey, researchKey, outlineKey, requireDNA, requireTopic, requireResearch, requireReady, analyzeDNA, generateIdeas, generateOutline, notebookPrompts, listDonorWorks, loadDonorWork, saveDonorWork, deleteDonorWork, donorBrief } from "../services/donorWorkflow.js";
import { reviewIdeas } from "../services/donorReview.js";
export const donorWorkflowRoute = new Hono();
const json = async (c: Context): Promise<unknown> => { try {
    return await c.req.json();
}
catch {
    throw new ApiError("VALIDATION", "Некорректный JSON", 400);
} };
const limit = bodyLimit({ maxSize: 1500000, onError: c => fail(c, new ApiError("VALIDATION", "Запрос больше 1,5 МБ", 413)) });
donorWorkflowRoute.use("/donor-workflow/*", limit);
donorWorkflowRoute.get("/donor-workflow/snapshots", async (c) => { try {
    c.header("Cache-Control", "no-store");
    return ok(c, await listDonorWorks());
}
catch (e) {
    return fail(c, e);
} });
donorWorkflowRoute.get("/donor-workflow/snapshots/:id", async (c) => { try {
    c.header("Cache-Control", "no-store");
    return ok(c, await loadDonorWork(c.req.param("id")));
}
catch (e) {
    return fail(c, e);
} });
donorWorkflowRoute.get("/donor-workflow/snapshots/:id/brief", async (c) => { try {
    c.header("Cache-Control", "no-store");
    return ok(c, await donorBrief(c.req.param("id")));
}
catch (e) {
    return fail(c, e);
} });
donorWorkflowRoute.post("/donor-workflow/snapshots", async (c) => { try {
    return ok(c, await saveDonorWork(await json(c)));
}
catch (e) {
    return fail(c, e);
} });
donorWorkflowRoute.delete("/donor-workflow/snapshots/:id", async (c) => { try {
    return ok(c, await deleteDonorWork(c.req.param("id")));
}
catch (e) {
    return fail(c, e);
} });
for (const stage of ["status", "notebook", "approve-dna", "approve-topic", "approve-outline", "analyze", "ideas", "outline", "review-ideas"]) {
    donorWorkflowRoute.post("/donor-workflow/" + stage, async (c) => {
        try {
            const w = Work.parse(await json(c));
            if (stage === "status")
                return ok(c, status(w));
            if (stage === "notebook")
                return ok(c, notebookPrompts(w));
            if (stage === "approve-dna") {
                w.dnaApproval = dnaKey(w);
                requireDNA(w);
                return ok(c, { dnaApproval: w.dnaApproval });
            }
            if (stage === "approve-topic") {
                w.topicApproval = topicKey(w);
                requireTopic(w);
                return ok(c, { topicApproval: w.topicApproval });
            }
            if (stage === "approve-outline") {
                requireResearch(w);
                if (w.outlineBasis !== researchKey(w))
                    throw new ApiError("VALIDATION", "План устарел: подготовьте новый или подтвердите адаптацию к новым материалам", 409);
                w.outlineApproval = outlineKey(w);
                requireReady(w);
                return ok(c, { outlineApproval: w.outlineApproval });
            }
            return ok(c, { jobId: startJob(ctx => stage === "analyze" ? analyzeDNA(w, ctx) : stage === "ideas" ? generateIdeas(w, ctx) : stage === "review-ideas" ? reviewIdeas(w, ctx) : generateOutline(w, ctx)) });
        }
        catch (e) {
            return fail(c, e);
        }
    });
}
