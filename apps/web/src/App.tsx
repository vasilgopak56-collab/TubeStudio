import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthGate } from "@/components/layout/AuthGate";
import { Spinner } from "@/components/ui";
import { ALL_ITEMS } from "@/lib/nav";
import { useThemeSync } from "@/lib/theme";

const Director = lazy(() => import("@/pages/Director"));
const DonorWorkflow = lazy(() => import("@/pages/DonorWorkflow"));
const VisualStyles = lazy(() => import("@/pages/VisualStyles"));
const Mcp = lazy(() => import("@/pages/Mcp"));
const AdBreaks = lazy(() => import("@/pages/AdBreaks"));
const Profit = lazy(() => import("@/pages/Profit"));
const Coach = lazy(() => import("@/pages/Coach"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Settings = lazy(() => import("@/pages/Settings"));
const Placeholder = lazy(() => import("@/pages/Placeholder"));
const UiKit = lazy(() => import("@/pages/UiKit"));
const Analysis = lazy(() => import("@/pages/Analysis"));
const Saved = lazy(() => import("@/pages/Saved"));
const Topics = lazy(() => import("@/pages/Topics"));
const Projects = lazy(() => import("@/pages/Projects"));
const ProjectDetail = lazy(() => import("@/pages/ProjectDetail"));
const Script = lazy(() => import("@/pages/Script"));
const Seo = lazy(() => import("@/pages/Seo"));
const AiDetector = lazy(() => import("@/pages/AiDetector"));
const Humanizer = lazy(() => import("@/pages/Humanizer"));
const ScriptRater = lazy(() => import("@/pages/ScriptRater"));
const Packaging = lazy(() => import("@/pages/Packaging"));
const AudioStoryboard = lazy(() => import("@/pages/AudioStoryboard"));
const Storyboard = lazy(() => import("@/pages/Storyboard"));
const Thumbnail = lazy(() => import("@/pages/Thumbnail"));
const Help = lazy(() => import("@/pages/Help"));
const Calendar = lazy(() => import("@/pages/Calendar"));
const VoiceProfile = lazy(() => import("@/pages/VoiceProfile"));
const PromptStudio = lazy(() => import("@/pages/PromptStudio"));
const AnyModel = lazy(() => import("@/pages/AnyModel"));
const Voice = lazy(() => import("@/pages/Voice"));
const Research = lazy(() => import("@/pages/Research"));
const Anomalies = lazy(() => import("@/pages/Anomalies"));
const Keywords = lazy(() => import("@/pages/Keywords"));
const Transcripts = lazy(() => import("@/pages/Transcripts"));
const SeoAudit = lazy(() => import("@/pages/SeoAudit"));
const DailyIdeas = lazy(() => import("@/pages/DailyIdeas"));
const VideoScorecard = lazy(() => import("@/pages/VideoScorecard"));
const Niches = lazy(() => import("@/pages/Niches"));
const Competitors = lazy(() => import("@/pages/Competitors"));
const Comments = lazy(() => import("@/pages/Comments"));
const Scorecard = lazy(() => import("@/pages/Scorecard"));
const Pipeline = lazy(() => import("@/pages/Pipeline"));
const Video = lazy(() => import("@/pages/Video"));
const MyAnalytics = lazy(() => import("@/pages/MyAnalytics"));
const Extension = lazy(() => import("@/pages/Extension"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Channels = lazy(() => import("@/pages/Channels"));
const Ideas = lazy(() => import("@/pages/Ideas"));
const StudioScript = lazy(() => import("@/pages/StudioScript"));
const StudioVoice = lazy(() => import("@/pages/StudioVoice"));
const StudioVisual = lazy(() => import("@/pages/StudioVisual"));

const READY: Record<string, React.ComponentType> = { "/channels": Channels, "/ideas": Ideas, "/studio/script": StudioScript, "/studio/voice": StudioVoice, "/studio/visual": StudioVisual, "/director": Director, "/donor-workflow": DonorWorkflow, "/styles": VisualStyles, "/mcp": Mcp, "/ad-breaks": AdBreaks, "/profit": Profit, "/coach": Coach, "/": Dashboard, "/settings": Settings, "/analysis": Analysis, "/saved": Saved, "/topics": Topics, "/projects": Projects, "/script": Script, "/seo": Seo, "/check/ai-detector": AiDetector, "/check/humanizer": Humanizer, "/check/script-rater": ScriptRater, "/check/packaging": Packaging, "/storyboard": Storyboard, "/audio-storyboard": AudioStoryboard, "/thumbnail": Thumbnail, "/calendar": Calendar, "/voice-profile": VoiceProfile, "/prompts": PromptStudio, "/anymodel": AnyModel, "/voice": Voice, "/research": Research, "/anomalies": Anomalies, "/keywords": Keywords, "/competitors": Competitors, "/niches": Niches, "/video-scorecard": VideoScorecard, "/daily-ideas": DailyIdeas, "/seo-audit": SeoAudit, "/transcripts": Transcripts, "/comments": Comments, "/check/scorecard": Scorecard, "/extension": Extension, "/pipeline": Pipeline, "/video": Video, "/my-analytics": MyAnalytics, "/help": Help };

export default function App() {
  useThemeSync();
  return (
    <AuthGate>
      {(s) => (
        <Suspense fallback={<div className="grid min-h-[50vh] place-items-center text-muted-foreground"><Spinner className="h-6 w-6" /></div>}>
          <Routes>
            <Route element={<AppLayout authRequired={s.required && !!s.passwordLogin} />}>
              {ALL_ITEMS.map((it) => {
                const C = READY[it.to] ?? Placeholder;
                return <Route key={it.to} path={it.to} element={<C />} />;
              })}
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/ui" element={<UiKit />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      )}
    </AuthGate>
  );
}
