import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  Sparkles,
  ListChecks,
  MessageSquare
} from "lucide-react";

import EducationMaterialGenerator from "@/components/education/EducationMaterialGenerator";
import TeachBackConfirmation from "@/components/education/TeachBackConfirmation";
import EducationLibrary from "@/components/education/EducationLibrary";
import SimplifiedExplanationGenerator from "@/components/education/SimplifiedExplanationGenerator";
import NextStepsSummaryGenerator from "@/components/education/NextStepsSummaryGenerator";
import TeachBackPromptsGenerator from "@/components/education/TeachBackPromptsGenerator";

export default function PatientEducation() {
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [_selectedTopic, _setSelectedTopic] = useState("");
  const [generatedMaterial, setGeneratedMaterial] = useState(null);
  const [teachBackRecords, setTeachBackRecords] = useState([]);

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  const handleMaterialGenerated = (material) => {
    setGeneratedMaterial(material);
  };

  const handleTeachBackRecorded = (record) => {
    setTeachBackRecords(prev => [...prev, record]);
  };

  // Get teach-back history for selected patient
  const patientTeachBackHistory = selectedPatientId 
    ? teachBackRecords.filter(r => r.patientId === selectedPatientId)
    : teachBackRecords;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Patient Selection */}
      <Card className="mb-6 border-blue-200">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label htmlFor="education-patient-select" className="text-sm font-medium text-slate-700 mb-1 block">
                Select Patient (Optional)
              </label>
              <Select value={selectedPatientId || "none"} onValueChange={(val) => setSelectedPatientId(val === "none" ? "" : val)}>
                <SelectTrigger id="education-patient-select">
                  <SelectValue placeholder="Choose a patient..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No patient selected</SelectItem>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} - {p.primary_diagnosis || 'No diagnosis'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedPatient && (
              <div className="flex items-end gap-2">
                <Badge className="bg-blue-100 text-blue-800 h-10 px-4 flex items-center">
                  {selectedPatient.primary_diagnosis || 'No diagnosis'}
                </Badge>
                <Badge className="bg-navy-100 text-navy-800 h-10 px-4 flex items-center">
                  {selectedPatient.care_type === 'hospice' ? 'Hospice' : 'Home Health'}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="generate" className="space-y-6">
        <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-grid">
          <TabsTrigger value="generate" className="gap-2">
            <Brain className="w-4 h-4" />
            <span className="hidden sm:inline">Materials</span>
          </TabsTrigger>
          <TabsTrigger value="simplify" className="gap-2">
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Simplify</span>
          </TabsTrigger>
          <TabsTrigger value="nextsteps" className="gap-2">
            <ListChecks className="w-4 h-4" />
            <span className="hidden sm:inline">Next Steps</span>
          </TabsTrigger>
          <TabsTrigger value="prompts" className="gap-2">
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">Teach-Back</span>
          </TabsTrigger>
          <TabsTrigger value="library" className="gap-2">
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Library</span>
          </TabsTrigger>
          <TabsTrigger value="records" className="gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span className="hidden sm:inline">Records</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <EducationMaterialGenerator
                patient={selectedPatient}
                teachBackHistory={patientTeachBackHistory}
                onMaterialGenerated={handleMaterialGenerated}
              />
            </div>
            <div>
              {generatedMaterial && (
                <TeachBackConfirmation
                  material={generatedMaterial}
                  patient={selectedPatient}
                  onRecorded={handleTeachBackRecorded}
                />
              )}
            </div>
          </div>
        </TabsContent>

        {/* Simplified Explanation Tab */}
        <TabsContent value="simplify">
          <div className="grid lg:grid-cols-2 gap-6">
            <SimplifiedExplanationGenerator
              patient={selectedPatient}
              diagnosis={selectedPatient?.primary_diagnosis}
            />
            <div className="space-y-4">
              <Card className="bg-gradient-to-br from-navy-50 to-gold-50 border-navy-200">
                <CardContent className="p-4">
                  <h3 className="font-bold text-navy-900 mb-2">💡 How to Use</h3>
                  <ul className="text-sm text-navy-800 space-y-2">
                    <li>1. Enter complex medical information</li>
                    <li>2. AI transforms it into simple language</li>
                    <li>3. Get analogies, FAQs, and speaking scripts</li>
                    <li>4. Copy the script to use with patients</li>
                  </ul>
                </CardContent>
              </Card>
              {generatedMaterial && (
                <TeachBackConfirmation
                  material={generatedMaterial}
                  patient={selectedPatient}
                  onRecorded={handleTeachBackRecorded}
                />
              )}
            </div>
          </div>
        </TabsContent>

        {/* Next Steps Summary Tab */}
        <TabsContent value="nextsteps">
          <div className="grid lg:grid-cols-2 gap-6">
            <NextStepsSummaryGenerator
              patient={selectedPatient}
              educationMaterial={generatedMaterial}
              diagnosis={selectedPatient?.primary_diagnosis}
            />
            <div className="space-y-4">
              <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
                <CardContent className="p-4">
                  <h3 className="font-bold text-green-900 mb-2">📋 Patient Take-Home Summary</h3>
                  <p className="text-sm text-green-800 mb-3">
                    Generate personalized "what to watch for" and "next steps" summaries for patients after education sessions.
                  </p>
                  <ul className="text-sm text-green-700 space-y-1">
                    <li>• Immediate action items</li>
                    <li>• Daily checklists</li>
                    <li>• Warning signs to watch</li>
                    <li>• When to call nurse vs 911</li>
                    <li>• Medication reminders</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* AI Teach-Back Prompts Tab */}
        <TabsContent value="prompts">
          <div className="grid lg:grid-cols-2 gap-6">
            <TeachBackPromptsGenerator
              patient={selectedPatient}
              educationMaterial={generatedMaterial}
              diagnosis={selectedPatient?.primary_diagnosis}
              onTeachBackComplete={handleTeachBackRecorded}
            />
            <div className="space-y-4">
              <Card className="bg-gradient-to-br from-indigo-50 to-navy-50 border-indigo-200">
                <CardContent className="p-4">
                  <h3 className="font-bold text-indigo-900 mb-2">🎯 AI-Assisted Teach-Back</h3>
                  <p className="text-sm text-indigo-800 mb-3">
                    Get tailored questions to ask patients based on their condition and literacy level.
                  </p>
                  <ul className="text-sm text-indigo-700 space-y-1">
                    <li>• Open-ended questions (not yes/no)</li>
                    <li>• Alternative phrasings if patient struggles</li>
                    <li>• What to listen for in responses</li>
                    <li>• AI-generated follow-ups for clarification</li>
                    <li>• Automatic documentation</li>
                  </ul>
                </CardContent>
              </Card>
              {generatedMaterial && (
                <TeachBackConfirmation
                  material={generatedMaterial}
                  patient={selectedPatient}
                  onRecorded={handleTeachBackRecorded}
                />
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="library">
          <EducationLibrary
            patient={selectedPatient}
            onSelectMaterial={(material) => setGeneratedMaterial(material)}
          />
        </TabsContent>

        <TabsContent value="records">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Teach-Back Documentation History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {teachBackRecords.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No teach-back records yet" description="Generate educational materials and document patient understanding." />
              ) : (
                <div className="space-y-4">
                  {teachBackRecords.map((record, idx) => (
                    <Card key={idx} className="border-l-4 border-l-green-500">
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <h4 className="font-semibold">{record.topic}</h4>
                            <p className="text-sm text-slate-600">{record.patientName}</p>
                          </div>
                          <Badge className={
                            record.understandingLevel === 'good' ? 'bg-green-100 text-green-800' :
                            record.understandingLevel === 'fair' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }>
                            {record.understandingLevel} understanding
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">{record.response}</p>
                        <p className="text-xs text-slate-500">
                          Recorded: {new Date(record.timestamp).toLocaleString()}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}