import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowLeft, User, Sparkles, FileText, Copy, CheckCircle2, Bot } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { createPageUrl } from "@/utils";
import ClinicalTemplateLibrary from "../components/templates/ClinicalTemplateLibrary";
import TemplateEditor from "../components/templates/TemplateEditor";

export default function TemplateLibrary() {
  const navigate = useNavigate();
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedTemplateData, setSelectedTemplateData] = useState(null);
  const [templateContent, setTemplateContent] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: patients } = useQuery({
    queryKey: ['templatePatients'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
    initialData: [],
  });

  const handleSelectTemplate = (data) => {
    setSelectedTemplateData(data);
    setTemplateContent(data.content?.template_content || '');
  };

  const handleCopyToClipboard = () => {
    navigator.clipboard.writeText(templateContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUseInVisit = async () => {
    if (selectedPatient && templateContent) {
      // Document Visit was retired; send the clinician to the unified Clinical
      // Notes hub (Smart Note / Visit Scribe). The hub composes the note itself,
      // so copy the generated template to the clipboard first (don't discard it)
      // and tell the nurse to paste it into their note.
      try {
        await navigator.clipboard.writeText(templateContent);
        toast.success("Template copied — paste it into your note in Clinical Notes.");
      } catch {
        toast.info("Couldn't copy automatically — copy the template, then paste it into your note.");
      }
      navigate(createPageUrl("ClinicalDocumentation"));
    } else {
      toast.error('Please select a patient and generate a template first.');
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={FileText}
        eyebrow="Documentation"
        title="Template Library"
        description="AI-intelligent documentation templates for various visit types and conditions"
        favoritePage="TemplateLibrary"
        actions={
          <Button
            variant="outline"
            onClick={() => navigate(createPageUrl("Dashboard"))}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        }
      />

      {/* Patient Selection */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600" />
            Select Patient (Optional)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Patient</Label>
              <Select value={selectedPatient || ''} onValueChange={setSelectedPatient}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a patient for personalized template..." />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(patient => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.first_name} {patient.last_name} - {patient.primary_diagnosis || 'No diagnosis'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPatient && (
              <div className="flex items-end">
                <Alert className="flex-1 bg-blue-50 border-blue-200">
                  <Sparkles className="w-4 h-4 text-blue-600" />
                  <AlertDescription className="text-blue-900 text-sm">
                    Template will be personalized for this patient's diagnosis and care needs.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Template Library */}
        <div>
          <ClinicalTemplateLibrary onSelectTemplate={handleSelectTemplate} />
        </div>

        {/* Template Editor or Empty State */}
        <div>
          {selectedTemplateData ? (
            <div className="space-y-4">
              <TemplateEditor
                templateData={selectedTemplateData}
                patient={patients.find(p => p.id === selectedPatient)}
                onContentChange={setTemplateContent}
              />
              
              {/* Action Buttons */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={handleCopyToClipboard}
                      variant="outline"
                      className="gap-2"
                    >
                      {copied ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Copy to Clipboard
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={handleUseInVisit}
                      className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                    >
                      <FileText className="w-4 h-4" />
                      Use in Visit Documentation
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="h-full border-2 border-dashed">
              <CardContent className="flex flex-col items-center justify-center h-full min-h-[400px] text-center p-8">
                <FileText className="w-16 h-16 text-slate-300 mb-4" />
                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                  Select a Template
                </h3>
                <p className="text-slate-500 max-w-sm">
                  Choose a visit type or condition template from the library to generate 
                  AI-powered clinical documentation.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Features Info */}
      <Card className="mt-8 border-l-4 border-l-gold-400">
        <CardContent className="p-6">
          <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            Template Library Features
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div>
              <h4 className="font-medium text-slate-900 mb-2 flex items-center gap-2"><FileText className="w-4 h-4 text-navy-600" /> Visit Type Templates</h4>
              <p className="text-sm text-slate-600">
                Pre-built templates for Admission, Routine, Recertification, Discharge, PRN, 
                and Supervisory visits with all required Medicare elements.
              </p>
            </div>
            <div>
              <h4 className="font-medium text-slate-900 mb-2 flex items-center gap-2"><Sparkles className="w-4 h-4 text-navy-600" /> Condition-Specific</h4>
              <p className="text-sm text-slate-600">
                Specialized templates for CHF, COPD, Diabetes, Wound Care, Stroke, 
                Orthopedic, Hospice, and Hypertension with condition-specific assessments.
              </p>
            </div>
            <div>
              <h4 className="font-medium text-slate-900 mb-2 flex items-center gap-2"><Bot className="w-4 h-4 text-navy-600" /> AI-Intelligent</h4>
              <p className="text-sm text-slate-600">
                Templates include clinical prompts, dropdown options for structured data, 
                and AI enhancement to complete documentation professionally.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}