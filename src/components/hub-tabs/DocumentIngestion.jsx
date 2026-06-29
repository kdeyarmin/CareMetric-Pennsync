import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap, FileText } from "lucide-react";
import DocumentIngestionUploader from "@/components/documents/DocumentIngestionUploader";
import DocumentToTriageMapper from "@/components/referral/DocumentToTriageMapper";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

export default function DocumentIngestion() {
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  useEffect(() => {
    if (currentUser?.email) {
      logActivity(ActivityActions.PAGE_VISIT, { page: "DocumentIngestion" });
    }
  }, [currentUser?.email]);

  return (
    <div className="space-y-4 sm:space-y-6">
      <Tabs defaultValue="extract" className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-white border border-slate-200 rounded-lg p-1">
          <TabsTrigger value="extract" className="gap-1.5">
            <Zap className="w-4 h-4" />
            Extract Data
          </TabsTrigger>
          <TabsTrigger value="mapper" className="gap-1.5">
            <FileText className="w-4 h-4" />
            Map to Triage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="extract">
          <Card>
            <CardHeader>
              <CardTitle>Extract Clinical Data</CardTitle>
              <CardDescription>
                Upload a scanned document or PDF to automatically extract patient information, vitals, and clinical findings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DocumentIngestionUploader />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-blue-900 mb-2">Demographics</h3>
                <p className="text-xs text-blue-800">
                  Extracts patient name, DOB, contact info, and medical record numbers
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-green-900 mb-2">Vital Signs</h3>
                <p className="text-xs text-green-800">
                  Recognizes BP, HR, temperature, O2 sat, respiratory rate, and pain levels
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-navy-50 to-navy-100 border-navy-200">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-navy-900 mb-2">Clinical Info</h3>
                <p className="text-xs text-navy-800">
                  Identifies diagnoses, medications, allergies, and clinical assessments
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="mapper">
          <Card>
            <CardHeader>
              <CardTitle>Document to Triage Workflow</CardTitle>
              <CardDescription>
                Upload a document and automatically create a patient profile and triage referral in one step
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DocumentToTriageMapper
                onTriageCreated={(data) => {
                  if (currentUser?.email) {
                    logActivity(ActivityActions.DOCUMENT_PROCESSED, {
                      patient_id: data.patientId,
                      referral_id: data.referralId,
                      confidence_score: data.extractedData.document_info?.confidence_score
                    });
                  }
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-base text-blue-900">Supported Document Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              "Clinical Records",
              "Faxed Documents",
              "Lab Results",
              "Imaging Reports",
              "Medication Lists",
              "Insurance Cards",
              "Admission Forms",
              "Discharge Summaries"
            ].map((type) => (
              <div key={type} className="flex items-center gap-2 text-blue-900">
                <div className="w-2 h-2 bg-blue-600 rounded-full" />
                {type}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}