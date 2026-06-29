import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain, Tag, ScanLine, MessageSquareWarning } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import AIAutoTagger from "@/components/admin/AIAutoTagger";
import OCRTrainingMonitor from "@/components/admin/OCRTrainingMonitor";
import OCRFeedbackDashboard from "@/components/admin/OCRFeedbackDashboard";

/**
 * AI Tools — operational AI/automation utilities for the agency admin.
 * Surfaces tools that previously had no entry point: bulk AI auto-tagging of
 * visits/incidents, the OCR model training monitor, and the OCR correction
 * feedback dashboard that feeds that training.
 */
export default function AIToolsCenterPage() {
  return (
    <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        icon={Brain}
        iconColor="bg-navy-600"
        eyebrow="Administration"
        title="AI Tools"
        description="Run AI-powered automation and monitor the models that drive document OCR and intelligent tagging."
        favoritePage="AIToolsCenter"
      />

      <Tabs defaultValue="tagger" className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="tagger" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Tag className="h-4 w-4 mr-2" />
              Auto-Tagger
            </TabsTrigger>
            <TabsTrigger value="ocr-training" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <ScanLine className="h-4 w-4 mr-2" />
              OCR Training
            </TabsTrigger>
            <TabsTrigger value="ocr-feedback" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <MessageSquareWarning className="h-4 w-4 mr-2" />
              OCR Feedback
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="tagger">
          <AIAutoTagger />
        </TabsContent>
        <TabsContent value="ocr-training">
          <OCRTrainingMonitor />
        </TabsContent>
        <TabsContent value="ocr-feedback">
          <OCRFeedbackDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
