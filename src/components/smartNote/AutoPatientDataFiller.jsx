import React, { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ChevronDown, ChevronUp, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

export default function AutoPatientDataFiller({ patientId, visitType, onDataFill }) {
  const [isExpanded, setIsExpanded] = React.useState(true);
  const [suggestedData, setSuggestedData] = React.useState(null);
  const [isGenerating, setIsGenerating] = React.useState(false);

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }).then(p => p[0]),
    enabled: !!patientId
  });

  const { data: recentVisits = [] } = useQuery({
    queryKey: ['recentVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 5),
    enabled: !!patientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  useEffect(() => {
    if (patient && !suggestedData) {
      generateContextualData();
    }
  }, [patient]);

  const generateContextualData = async () => {
    if (!patient) return;
    
    setIsGenerating(true);
    try {
      const lastVisit = recentVisits[0];
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');

      const contextData = {
        patientName: `${patient.first_name} ${patient.last_name}`,
        age: patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / 31557600000) : null,
        primaryDiagnosis: patient.primary_diagnosis,
        allergies: patient.allergies || "No known allergies",
        currentMedications: patient.current_medications?.length > 0 
          ? patient.current_medications.map(m => `${m.name} ${m.dosage}`).join(", ")
          : "None documented",
        baselineVitals: patient.baseline_vitals ? {
          bp: `${patient.baseline_vitals.blood_pressure_systolic}/${patient.baseline_vitals.blood_pressure_diastolic}`,
          hr: patient.baseline_vitals.heart_rate,
          temp: patient.baseline_vitals.temperature,
          o2: patient.baseline_vitals.oxygen_saturation
        } : null,
        recentChanges: lastVisit?.nurse_notes ? `Last visit: ${lastVisit.nurse_notes.substring(0, 200)}...` : null,
        activeGoals: activeCarePlans.map(cp => cp.goal).join("; ")
      };

      // Generate AI-enhanced contextual summary
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a brief clinical context paragraph (2-3 sentences) for ${visitType} visit documentation based on this patient data:
        
Patient: ${contextData.patientName}, Age ${contextData.age}
Primary Diagnosis: ${contextData.primaryDiagnosis}
Allergies: ${contextData.allergies}
Current Medications: ${contextData.currentMedications}
Active Care Goals: ${contextData.activeGoals || "None documented"}
${contextData.recentChanges ? `Recent Note: ${contextData.recentChanges}` : ''}

Format: Brief, clinically-relevant context suitable for starting a ${visitType} note.`,
      });

      setSuggestedData({
        ...contextData,
        aiGeneratedContext: response
      });
    } catch (error) {
      console.error("Error generating contextual data:", error);
      toast.error("Failed to generate patient context");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApplyData = () => {
    if (suggestedData && onDataFill) {
      onDataFill(suggestedData);
      toast.success("Patient context applied to note");
    }
  };

  if (!patient) return null;

  return (
    <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <CardTitle className="text-base">AI Patient Context</CardTitle>
            <Badge variant="outline" className="text-xs">Auto-filled</Badge>
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </CardHeader>
      
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <CardContent className="space-y-3">
              {isGenerating ? (
                <div className="flex items-center gap-2 text-sm text-blue-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent" />
                  Analyzing patient data...
                </div>
              ) : suggestedData ? (
                <>
                  <div className="bg-white/60 rounded-lg p-3 space-y-2 text-sm">
                    <p className="font-medium text-blue-900">{suggestedData.aiGeneratedContext}</p>
                    
                    <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t">
                      {suggestedData.age && (
                        <div>
                          <span className="text-gray-500 text-xs">Age:</span>
                          <p className="font-medium">{suggestedData.age} years</p>
                        </div>
                      )}
                      {suggestedData.primaryDiagnosis && (
                        <div>
                          <span className="text-gray-500 text-xs">Diagnosis:</span>
                          <p className="font-medium text-xs">{suggestedData.primaryDiagnosis}</p>
                        </div>
                      )}
                      {suggestedData.allergies && (
                        <div className="col-span-2">
                          <span className="text-gray-500 text-xs">Allergies:</span>
                          <p className="font-medium text-xs">{suggestedData.allergies}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <Button 
                    onClick={handleApplyData}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    size="sm"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    Apply to Note
                  </Button>
                </>
              ) : null}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}