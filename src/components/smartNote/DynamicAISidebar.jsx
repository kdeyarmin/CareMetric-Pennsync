import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Brain, 
  Sparkles, 
  Copy, 
  ClipboardList, 
  RotateCcw,
  ArrowRight,
  Lightbulb,
  BookOpen,
  Link as LinkIcon
} from "lucide-react";
import ClinicalGuidelinesAssistant from "./ClinicalGuidelinesAssistant";
import OASISItemLinker from "./OASISItemLinker";

export default function DynamicAISidebar({
  currentStep,
  hasPatient,
  hasNotes,
  hasEnhancedNote,
  diagnosis,
  complianceScore,
  patientData,
  vitalSigns,
  hasOASIS,
  oasisLinkedItems = [],
  onAction,
  onInsertGuideline,
  onAddOASISLink,
  onRemoveOASISLink,
  roughNote = "",
  criticalGaps = []
}) {
  // Analyze vitals for clinical alerts
  const analyzeVitals = () => {
    const alerts = [];
    if (vitalSigns.bp) {
      const bpParts = vitalSigns.bp.split('/');
      if (bpParts.length === 2) {
        const systolic = parseInt(bpParts[0]);
        const diastolic = parseInt(bpParts[1]);
        if (systolic > 140 || systolic < 90) {
          alerts.push({ 
            text: `BP ${systolic}/${diastolic} is ${systolic > 140 ? 'elevated' : 'low'}`, 
            action: 'Document physician notification if critically abnormal',
            severity: systolic > 160 || systolic < 80 ? 'critical' : 'warning'
          });
        }
      }
    }
    if (vitalSigns.o2 && parseInt(vitalSigns.o2) < 92) {
      alerts.push({ 
        text: `O2 Sat ${vitalSigns.o2}% is low`, 
        action: 'Document respiratory assessment and interventions',
        severity: parseInt(vitalSigns.o2) < 88 ? 'critical' : 'warning'
      });
    }
    if (vitalSigns.temp && parseFloat(vitalSigns.temp) > 99.5) {
      alerts.push({ 
        text: `Temp ${vitalSigns.temp}°F is elevated`, 
        action: 'Document infection assessment and plan',
        severity: parseFloat(vitalSigns.temp) > 101 ? 'critical' : 'warning'
      });
    }
    return alerts;
  };

  // Analyze rough note for documentation quality
  const analyzeDocumentation = () => {
    if (!roughNote || roughNote.length < 30) return null;
    
    const content = roughNote.toLowerCase();
    const gaps = [];

    if (!content.includes('homebound') && !content.includes('taxing')) {
      gaps.push({ element: 'Homebound Status', priority: 'critical' });
    }
    if (!content.includes('skilled') && roughNote.length > 100) {
      gaps.push({ element: 'Skilled Need', priority: 'critical' });
    }
    if (!content.includes('patient') && !content.includes('response') && roughNote.length > 100) {
      gaps.push({ element: 'Patient Response', priority: 'high' });
    }

    return gaps;
  };

  const vitalAlertsList = analyzeVitals();
  const docGaps = analyzeDocumentation();

  // Determine which tools to show based on workflow step
  const getContent = () => {
    // Step 1: No patient selected - don't show sidebar
    if (!hasPatient) {
      return null;
    }

    // Step 2: Vitals entry with clinical context
    if (currentStep === 'vitals') {
      return {
        title: "📊 Vital Signs Entry",
        message: vitalAlertsList.length > 0 
          ? vitalAlertsList[0].text
          : "Enter vital signs for clinical context",
        guidance: vitalAlertsList.length > 0 
          ? vitalAlertsList[0].action
          : "AI will use vitals for clinical decision support",
        alertSeverity: vitalAlertsList[0]?.severity,
        actions: [],
        showGuidelines: false
      };
    }

    // Step 3: Note documentation with gap analysis
    if (currentStep === 'notes') {
      const gaps = docGaps || [];
      return {
        title: gaps.length > 0 ? "⚠️ Documentation Gaps" : "📝 Document Visit",
        message: gaps.length > 0 
          ? `${gaps.length} critical element${gaps.length > 1 ? 's' : ''} missing`
          : hasNotes 
            ? "Add skilled interventions and patient response"
            : "Type notes or use voice dictation",
        guidance: gaps.length > 0 
          ? `Missing: ${gaps[0].element}` 
          : "Include homebound status, skilled need, patient response",
        actions: [],
        showGuidelines: true,
        showOASISLinker: hasOASIS,
        alertSeverity: gaps.length > 0 ? 'warning' : null
      };
    }

    // Step 2-3: Patient selected, ready to enhance
    if (!hasEnhancedNote && hasNotes) {
      const urgentGaps = criticalGaps.filter(g => g.priority === 'critical');
      return {
        title: urgentGaps.length > 0 ? "🚨 Critical Gaps Found" : "✨ Ready to Enhance",
        message: urgentGaps.length > 0 
          ? `${urgentGaps.length} critical Medicare element${urgentGaps.length > 1 ? 's' : ''} missing`
          : `AI will transform your notes into Medicare-compliant documentation${diagnosis ? ` optimized for ${diagnosis.split(' ')[0]}` : ''}`,
        guidance: urgentGaps.length > 0 
          ? `Most urgent: ${urgentGaps[0].element}`
          : "Use the main Enhance button to transform your notes",
        actions: [],
        showGuidelines: true,
        showOASISLinker: hasOASIS,
        alertSeverity: urgentGaps.length > 0 ? 'critical' : null
      };
    }

    // Before enhancement but no notes yet
    if (!hasEnhancedNote) {
      return {
        title: "📝 Document Visit",
        message: "Enter your rough notes to get started",
        guidance: "Use voice dictation or type your observations",
        actions: [],
        showGuidelines: true,
        showOASISLinker: hasOASIS
      };
    }

    // Step 4: Enhanced note ready
    return {
      title: "🎉 Note Complete!",
      message: complianceScore 
        ? `${complianceScore}% Medicare compliant`
        : "Review and finalize your note",
      guidance: complianceScore >= 90 
        ? "Excellent compliance! Ready to copy to EHR"
        : complianceScore >= 80 
          ? "Good compliance - review suggestions below"
          : "Review compliance warnings to improve score",
      actions: [
        { label: "Copy to EHR", action: "copy", icon: Copy, primary: true },
        { label: "Generate Tasks", action: "tasks", icon: ClipboardList },
        { label: "Start New Note", action: "clear", icon: RotateCcw }
      ],
      alertSeverity: complianceScore < 80 ? 'warning' : null
    };
  };

  const content = getContent();

  if (!content) return null;

  const borderColorClass = content.alertSeverity === 'critical' ? 'border-red-400' :
                           content.alertSeverity === 'warning' ? 'border-yellow-400' :
                           'border-indigo-200';
  
  const bgColorClass = content.alertSeverity === 'critical' ? 'from-red-50 to-orange-50' :
                       content.alertSeverity === 'warning' ? 'from-yellow-50 to-amber-50' :
                       'from-indigo-50 to-white';

  return (
    <div className="space-y-4">
      {/* Main AI Assistant Card */}
      <Card className={`border-2 ${borderColorClass} bg-gradient-to-b ${bgColorClass} sticky top-4 ${content.alertSeverity ? 'shadow-lg animate-pulse' : ''}`}>
        <CardHeader className="py-3 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className={`w-4 h-4 ${content.alertSeverity === 'critical' ? 'text-red-600' : content.alertSeverity === 'warning' ? 'text-yellow-600' : 'text-indigo-600'}`} />
            {content.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-2 space-y-3">
          <p className={`text-xs font-medium flex items-start gap-2 ${content.alertSeverity === 'critical' ? 'text-red-700' : content.alertSeverity === 'warning' ? 'text-yellow-700' : 'text-gray-600'}`}>
            {content.alertSeverity && (
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            )}
            {content.message}
          </p>

          {content.guidance && (
            <div className={`p-2 rounded-lg text-xs ${
              content.alertSeverity === 'critical' ? 'bg-red-100 border border-red-300 text-red-800' :
              content.alertSeverity === 'warning' ? 'bg-yellow-100 border border-yellow-300 text-yellow-800' :
              'bg-blue-100 border border-blue-300 text-blue-800'
            }`}>
              <p className="flex items-start gap-1 font-medium">
                <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
                {content.guidance}
              </p>
            </div>
          )}

          {content.actions.length > 0 && (
            <div className="space-y-2">
              {content.actions.map((action, idx) => (
                <Button
                  key={idx}
                  size="sm"
                  variant={action.primary ? "default" : "outline"}
                  className={`w-full justify-between ${
                    action.primary ? 
                      action.highlight ? 'bg-red-600 hover:bg-red-700 animate-pulse' : 
                      'bg-indigo-600 hover:bg-indigo-700' 
                    : ''
                  }`}
                  onClick={() => onAction?.(action.action)}
                >
                  <span className="flex items-center gap-2">
                    {action.icon && <action.icon className="w-3 h-3" />}
                    {action.label}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clinical Guidelines - Only before enhancement */}
      {content.showGuidelines && diagnosis && (
        <ClinicalGuidelinesAssistant
          diagnosis={diagnosis}
          patientData={patientData}
          vitalSigns={vitalSigns}
          onInsertGuideline={onInsertGuideline}
        />
      )}

      {/* OASIS Item Linker - Only if OASIS data exists */}
      {content.showOASISLinker && hasOASIS && (
        <OASISItemLinker
          linkedItems={oasisLinkedItems}
          onAddLink={onAddOASISLink}
          onRemoveLink={onRemoveOASISLink}
          selectedText=""
        />
      )}
    </div>
  );
}