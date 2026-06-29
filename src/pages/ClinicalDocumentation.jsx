import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, Mic, Brain, FileAudio } from "lucide-react";
import SmartNoteAssistant from "@/pages/SmartNoteAssistant";
import RealTimeDictationScribe from "@/components/visit/RealTimeDictationScribe";
import AudioVisitCapture from "@/components/visit/AudioVisitCapture";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import EmbeddedPage from "@/components/ui/embeddedPage";

// Documenting a visit is a choice between two methods: write a Smart Note (AI
// compliance help) or use the Visit Scribe (record/upload audio or live dictate).
const TAB_KEYS = ["smart-notes", "visit-scribe"];

// Legacy ?tab values from before the Smart Note / Visit Scribe consolidation, so
// old links and the Visit Scribe / Medical Scribe redirects keep working:
//  - "record" / "live-dictation" → the Visit Scribe choice (record is the default
//    sub-mode; "live-dictation" opens the Dictation sub-mode)
//  - "quick-guide" → the default Smart Note choice
const LEGACY_TAB = { record: "visit-scribe", "live-dictation": "visit-scribe", "quick-guide": "smart-notes" };

export default function ClinicalDocumentation() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const normalizedTab = LEGACY_TAB[requestedTab] ?? requestedTab;
  const activeTab = TAB_KEYS.includes(normalizedTab) ? normalizedTab : "smart-notes";
  // Visit Scribe sub-mode: default to Record / Upload; a legacy ?tab=live-dictation
  // link opens the Dictation sub-mode instead.
  const initialScribeMode = requestedTab === "live-dictation" ? "dictation" : "record";
  // Optional deep-link to document a specific existing visit (e.g. from a
  // compliance alert or a patient's visit list). Passed to the active flow so the
  // save COMPLETES that visit instead of creating a duplicate.
  const visitId = searchParams.get("visitId") || null;

  // Preserve any ?visitId binding when switching tabs (only the tab key changes).
  // Reflect the active choice in the URL so it's shareable/bookmarkable; the
  // default Smart Note choice stays a clean URL apart from a present visitId.
  const handleTabChange = (value) => {
    const next = {};
    if (value !== "smart-notes") next.tab = value;
    if (visitId) next.visitId = visitId;
    setSearchParams(next);
  };

  // Converge on the canonical URL: strip a redundant, legacy, or unknown ?tab=
  // once it resolves to the default Smart Note choice (a valid deep-link like
  // ?tab=visit-scribe is left untouched). A ?visitId binding is always preserved.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "smart-notes") {
      setSearchParams(visitId ? { visitId } : {}, { replace: true });
    }
  }, [requestedTab, activeTab, visitId, setSearchParams]);

  return (
    <PageContainer>
      <PageHeader
        icon={Brain}
        eyebrow="Documentation"
        title="Clinical Notes"
        description="Document a visit two ways: write a Smart Note with AI compliance help, or use the Visit Scribe to record/upload audio or dictate."
        favoritePage="ClinicalDocumentation"
      />
        <EmbeddedPage>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="flex w-full gap-2">
            <TabsTrigger value="smart-notes" className="flex-1 min-h-[44px] font-semibold">
              <Sparkles className="w-4 h-4" /> Smart Note
            </TabsTrigger>
            <TabsTrigger value="visit-scribe" className="flex-1 min-h-[44px] font-semibold">
              <Mic className="w-4 h-4" /> Visit Scribe
            </TabsTrigger>
          </TabsList>

          {/* Smart Note — write rough notes; AI checks compliance and polishes. */}
          <TabsContent value="smart-notes">
            <SmartNoteAssistant visitId={visitId} />
          </TabsContent>

          {/* Visit Scribe — capture the visit by audio (record/upload) or by
              speaking it (live dictation); both transcribe into a compliant note. */}
          <TabsContent value="visit-scribe">
            <Tabs defaultValue={initialScribeMode} className="space-y-4">
              <TabsList className="flex w-full gap-2 max-w-md">
                <TabsTrigger value="record" className="flex-1 min-h-[44px]">
                  <FileAudio className="w-4 h-4" /> Record / Upload
                </TabsTrigger>
                <TabsTrigger value="dictation" className="flex-1 min-h-[44px]">
                  <Mic className="w-4 h-4" /> Live Dictation
                </TabsTrigger>
              </TabsList>

              <TabsContent value="record">
                <AudioVisitCapture currentUser={currentUser} visitId={visitId} />
              </TabsContent>

              <TabsContent value="dictation">
                <Card>
                  <CardContent className="p-6">
                    <RealTimeDictationScribe currentUser={currentUser} />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
        </EmbeddedPage>
    </PageContainer>
  );
}