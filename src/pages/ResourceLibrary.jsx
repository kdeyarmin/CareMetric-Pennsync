import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, GraduationCap, Stethoscope } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import ClinicalLibraryManager from "@/components/clinical/ClinicalLibraryManager";
import ClinicalReferencePanel from "@/components/clinical/ClinicalReferencePanel";
import EducationLibrary from "@/components/education/EducationLibrary";

export default function ResourceLibrary() {
  return (
    <PageContainer>
      <PageHeader
        icon={BookOpen}
        eyebrow="Resources"
        title="Resource Library"
        description="Clinical templates, clinical reference, and patient education materials"
        favoritePage="ResourceLibrary"
      />

      <Tabs defaultValue="clinical" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 gap-1">
          <TabsTrigger value="clinical" className="min-h-[44px]">
            <BookOpen className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">Clinical </span>Templates
          </TabsTrigger>
          <TabsTrigger value="reference" className="min-h-[44px]">
            <Stethoscope className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">Clinical </span>Reference
          </TabsTrigger>
          <TabsTrigger value="education" className="min-h-[44px]">
            <GraduationCap className="w-4 h-4 mr-1.5" />
            <span className="hidden sm:inline">Patient </span>Education
          </TabsTrigger>
        </TabsList>

        <TabsContent value="clinical">
          <ClinicalLibraryManager />
        </TabsContent>

        <TabsContent value="reference">
          <ClinicalReferencePanel />
        </TabsContent>

        <TabsContent value="education">
          <EducationLibrary />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}