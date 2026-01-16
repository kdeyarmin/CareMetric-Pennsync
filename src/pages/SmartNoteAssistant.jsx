import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  Brain,
  Wand2,
  Users,
  X,
  AlertTriangle,
  Loader2,
  Plus,
  ShieldAlert,
  ListTodo,
  Clock
  } from "lucide-react";
import { getVisitTypesForProvider } from "@/components/utils/providerVisitTypeMapping";
import { toast } from "sonner";
import { getProviderCompliancePrompt } from "@/components/utils/providerSpecificConfig";
import { getEnhanceNotePrompt } from "@/components/utils/prompts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CarePlanSuggestionsPanel from "@/components/smartNote/CarePlanSuggestionsPanel";
import NoteTemplateSelector from "@/components/smartNote/NoteTemplateSelector";

import AutoPopulateDataFields from "@/components/smartNote/AutoPopulateDataFields";
import AIFollowUpTasksGenerator from "@/components/smartNote/AIFollowUpTasksGenerator";
import EnhancedICD10Suggester from "@/components/clinical/EnhancedICD10Suggester";

export default function SmartNoteAssistant() {
  const [selectedPatient, setSelectedPatient] = useState("no_patient");
  const [showCreatePatient, setShowCreatePatient] = useState(false);
  const [visitType, setVisitType] = useState("");
  const [selectedDiagnosis, setSelectedDiagnosis] = useState("");
  const [diagnosisSearch, setDiagnosisSearch] = useState("");
  const [roughNotes, setRoughNotes] = useState("");
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedNote, setEnhancedNote] = useState(null);
  const [complianceResults, setComplianceResults] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [medicareViolations, setMedicareViolations] = useState([]);
  const [regulatoryWarnings, setRegulatoryWarnings] = useState([]);
  const [suggestedTasks, setSuggestedTasks] = useState([]);
  const [newPatientData, setNewPatientData] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    medical_record_number: ""
  });
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('fromScribe') === 'true') {
        const preFilledNote = sessionStorage.getItem('preFilledNote');
        if (preFilledNote) {
            setRoughNotes(preFilledNote);
            sessionStorage.removeItem('preFilledNote');
        }
    }
  }, [location]);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ["allPatients"],
    queryFn: async () => {
      return await base44.entities.Patient.list('-updated_date', 500);
    }
  });

  const { data: customComplianceRules = [] } = useQuery({
    queryKey: ['activeComplianceRules'],
    queryFn: async () => {
      const rules = await base44.entities.ComplianceRule.list('-created_date', 500);
      return rules.filter(rule => rule.is_active);
    }
  });

  const createNewPatient = async () => {
    if (!newPatientData.first_name.trim() || !newPatientData.last_name.trim()) {
      toast.error("First and last name are required");
      return;
    }

    setCreatingPatient(true);
    try {
      const created = await base44.entities.Patient.create({
        first_name: newPatientData.first_name,
        last_name: newPatientData.last_name,
        date_of_birth: newPatientData.date_of_birth || null,
        medical_record_number: newPatientData.medical_record_number || ""
      });

      setSelectedPatient(created.id);
      setShowCreatePatient(false);
      setNewPatientData({
        first_name: "",
        last_name: "",
        date_of_birth: "",
        medical_record_number: ""
      });
      toast.success("Patient created successfully");
    } catch (error) {
      toast.error("Failed to create patient");
      console.error(error);
    } finally {
      setCreatingPatient(false);
    }
  };

  const enhanceNote = async () => {
    if (!roughNotes.trim()) {
      toast.error("Please enter clinical notes");
      return;
    }

    if (!visitType) {
      toast.error("Please select a visit type");
      return;
    }

    if (!selectedDiagnosis) {
      toast.error("Please select a diagnosis");
      return;
    }

    const loadingToast = toast.loading("Enhancing note and analyzing quality...");
    setEnhancing(true);
    setEnhancedNote(null);
    setComplianceResults(null);
    setShowResults(false);
    setMedicareViolations([]);
    setRegulatoryWarnings([]);
    setSuggestedTasks([]);

    try {
      const compliancePrompt = getProviderCompliancePrompt(currentUser?.credential_type || 'RN', visitType);
      
      // Filter custom rules applicable to this visit type
      const applicableRules = customComplianceRules.filter(rule => {
        if (!rule.applies_to_visit_types || rule.applies_to_visit_types.length === 0) return true;
        return rule.applies_to_visit_types.includes(visitType);
      });

      // Single consolidated backend call
      const { enhanceNoteWithQuality } = await import('@/functions/enhanceNoteWithQuality');
      const response = await enhanceNoteWithQuality({
        rough_notes: roughNotes,
        visit_type: visitType,
        diagnosis: selectedDiagnosis,
        provider_type: currentUser?.credential_type || 'RN',
        compliance_prompt: compliancePrompt,
        custom_rules: applicableRules,
        patient_id: selectedPatient !== 'no_patient' ? selectedPatient : null
      });

      const result = response.data;

      // Update all state with consolidated results
      setExtractedData(result.extracted_data);
      setEnhancedNote(result.enhanced_note);
      setComplianceResults({
        ...result.compliance_check,
        quality_analysis: result.quality_analysis
      });
      setMedicareViolations(result.compliance_check?.medicare_violations || []);
      setRegulatoryWarnings(result.compliance_check?.regulatory_warnings || []);
      setSuggestedTasks(result.suggested_tasks || []);
      setShowResults(true);

      toast.dismiss(loadingToast);
      if (result.compliance_check?.compliance_score >= 85) {
        toast.success("Note enhanced - Medicare compliant!");
      } else {
        toast.warning("Note enhanced - Review compliance warnings");
      }
    } catch (error) {
      console.error('Error enhancing note:', error);
      toast.dismiss(loadingToast);
      toast.error(`Failed to enhance note: ${error.message || 'Unknown error'}`);
    } finally {
      setEnhancing(false);
    }
  };

  const availableVisitTypes = currentUser?.credential_type ?
  getVisitTypesForProvider(currentUser.credential_type) :
  [];

  // Common diagnoses list
  const commonDiagnoses = [
  "Congestive Heart Failure (CHF)",
  "Chronic Obstructive Pulmonary Disease (COPD)",
  "Diabetes Mellitus Type 2",
  "Hypertension",
  "Pneumonia",
  "Urinary Tract Infection (UTI)",
  "Wound Care - Pressure Ulcer",
  "Post-Surgical Care",
  "Chronic Kidney Disease",
  "Dementia/Alzheimer's Disease",
  "Stroke/CVA Recovery",
  "Cancer Care",
  "Palliative Care",
  "Chronic Pain Management",
  "Sepsis",
  "Cellulitis",
  "Dehydration",
  "Fall Risk/Fall Injury",
  "Malnutrition",
  "Depression"];


  const filteredDiagnoses = diagnosisSearch.trim() ?
  commonDiagnoses.filter((d) =>
  d.toLowerCase().includes(diagnosisSearch.toLowerCase())
  ) :
  commonDiagnoses;

  const getSelectedPatientData = () => {
    if (selectedPatient === "no_patient" || selectedPatient === "create_new") return null;
    return allPatients.find((p) => p.id === selectedPatient);
  };

  const patientData = getSelectedPatientData();

  return (
    <div className="min-h-screen p-2 sm:p-4 md:p-6 overflow-x-hidden">
      <div className="max-w-4xl mx-auto space-y-4 w-full">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">Smart Note Assistant</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            AI-powered documentation with compliance checking
          </p>
        </div>

        {!showResults ?
        <>
            {/* Streamlined Input Form */}
            <Card>
              <CardHeader className="bg-slate-200 p-6 flex flex-col space-y-1.5">
                <CardTitle className="flex items-center gap-2">
                  <Wand2 className="w-5 h-5" />
                  Clinical Documentation
                </CardTitle>
              </CardHeader>
              <CardContent className="bg-slate-100 pt-0 p-6 space-y-4">
                {/* Patient Selection Dropdown */}
                <div className="bg-slate-100">
                  <Label className="text-sm font-medium">Patient *</Label>
                  <Select value={selectedPatient} onValueChange={setSelectedPatient}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select patient..." />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="no_patient">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                          <span>No Patient Data (Anonymous)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="create_new">
                        <div className="flex items-center gap-2">
                          <Plus className="w-4 h-4 text-blue-500" />
                          <span>Create New Patient</span>
                        </div>
                      </SelectItem>
                      {allPatients.map((patient) =>
                    <SelectItem key={patient.id} value={patient.id}>
                          {patient.first_name} {patient.last_name} - MRN: {patient.medical_record_number}
                        </SelectItem>
                    )}
                    </SelectContent>
                  </Select>
                  {selectedPatient === "no_patient" &&
                <p className="text-xs text-orange-600 mt-1">
                      ⚠️ Note will not be saved to patient records
                    </p>
                }
                  {patientData &&
                <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-800 rounded text-sm">
                      <strong>Selected:</strong> {patientData.first_name} {patientData.last_name}
                      {patientData.primary_diagnosis &&
                  <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          Primary: {patientData.primary_diagnosis}
                        </div>
                  }
                    </div>
                }
                </div>

                {/* Visit Type & Diagnosis */}
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium">Visit Type *</Label>
                    <Select value={visitType} onValueChange={setVisitType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select visit type..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {availableVisitTypes.length > 0 ?
                      availableVisitTypes.map((vt) =>
                      <SelectItem key={vt.id} value={vt.id}>
                              {vt.label}
                            </SelectItem>
                      ) :

                      <SelectItem value="no_types" disabled>
                            No visit types available for your provider type
                          </SelectItem>
                      }
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">Primary Diagnosis *</Label>
                    <Select value={selectedDiagnosis} onValueChange={setSelectedDiagnosis}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select diagnosis..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {commonDiagnoses.map((diagnosis, idx) =>
                      <SelectItem key={idx} value={diagnosis}>
                            {diagnosis}
                          </SelectItem>
                      )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Template Selector */}
                {visitType && currentUser?.credential_type &&
              <NoteTemplateSelector
                visitType={visitType}
                providerType={currentUser.credential_type}
                onSelectTemplate={(formattedNote, template) => {
                  setRoughNotes(formattedNote);
                  setSelectedTemplate(template);
                }} />

              }

                {/* Vital Signs */}
                <div>
                  <Label className="text-sm font-medium">Vital Signs</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-2">
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Temperature (°F)</label>
                      <Input
                      type="number"
                      step="0.1"
                      placeholder="98.6"
                      className="h-9" />

                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Heart Rate (bpm)</label>
                      <Input
                      type="number"
                      placeholder="72"
                      className="h-9" />

                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Resp Rate</label>
                      <Input
                      type="number"
                      placeholder="16"
                      className="h-9" />

                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">BP Systolic</label>
                      <Input
                      type="number"
                      placeholder="120"
                      className="h-9" />

                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">BP Diastolic</label>
                      <Input
                      type="number"
                      placeholder="80"
                      className="h-9" />

                    </div>
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">O2 Sat (%)</label>
                      <Input
                      type="number"
                      placeholder="98"
                      className="h-9" />

                    </div>
                  </div>
                </div>

                {/* Rough Notes Input */}
                <div>
                  <Label className="text-sm font-medium">Clinical Notes *</Label>
                  <textarea
                  value={roughNotes}
                  onChange={(e) => setRoughNotes(e.target.value)}
                  placeholder="Enter your rough clinical notes here...

Example: Patient reports feeling better, pain level 2/10. Medications reviewed, compliant. Wound healing well, no signs of infection. Patient ambulating with walker..."








                  className="w-full h-48 p-3 border rounded-lg text-sm resize-none"
                  />


                </div>

                {/* Enhance Button */}
                <Button
                onClick={enhanceNote}
                disabled={enhancing || !visitType || !selectedDiagnosis || !roughNotes.trim()}
                className="w-full h-12 bg-indigo-600 hover:bg-indigo-700 text-white"
                size="lg">

                  {enhancing ?
                <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Enhancing Note & Running Compliance Checks...
                    </> :

                <>
                      <Wand2 className="w-5 h-5 mr-2" />
                      Enhance Note
                    </>
                }
                </Button>
              </CardContent>
            </Card>
          </> :

        <>
            {/* Results Page */}
            <div className="space-y-4">
              {/* Enhanced Note Display */}
              <Card className="border-green-300 bg-green-50 dark:bg-green-950">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      Enhanced Compliant Note
                    </span>
                    <Button
                    onClick={() => {
                      navigator.clipboard.writeText(enhancedNote);
                      toast.success("Enhanced note copied");
                    }}
                    variant="outline"
                    size="sm">

                      Copy Note
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-white dark:bg-slate-900 p-4 rounded-lg text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                    {enhancedNote}
                  </div>
                </CardContent>
              </Card>

              {/* Quality & Compliance Scores */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Medicare Compliance */}
                <Card className={complianceResults?.compliance_score >= 85 ? 'border-green-300 bg-green-50 dark:bg-green-950' : 'border-red-300 bg-red-50 dark:bg-red-950'}>
                  <CardContent className="p-4">
                    <div className="text-center">
                      {complianceResults?.compliance_score >= 85 ?
                        <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" /> :
                        <ShieldAlert className="w-8 h-8 text-red-600 mx-auto mb-2" />
                      }
                      <p className="font-semibold text-sm mb-1">Medicare Compliance</p>
                      <span className={`text-3xl font-bold ${
                        complianceResults?.compliance_score >= 85 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {complianceResults?.compliance_score || 0}%
                      </span>
                      <p className="text-xs text-gray-600 mt-1">
                        {complianceResults?.compliance_score >= 85 ? '✓ Meets threshold' : '✗ Below 85%'}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Quality Score */}
                {complianceResults?.quality_analysis && (
                  <>
                    <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
                      <CardContent className="p-4">
                        <div className="text-center">
                          <Brain className="w-8 h-8 text-purple-600 mx-auto mb-2" />
                          <p className="font-semibold text-sm mb-1">Documentation Quality</p>
                          <span className={`text-3xl font-bold ${
                            complianceResults.quality_analysis.overall_quality_score >= 90 ? 'text-green-600' :
                            complianceResults.quality_analysis.overall_quality_score >= 75 ? 'text-yellow-600' :
                            'text-red-600'
                          }`}>
                            {complianceResults.quality_analysis.overall_quality_score}%
                          </span>
                          <p className="text-xs text-gray-600 mt-1">Overall quality</p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950">
                      <CardContent className="p-4">
                        <div className="text-center">
                          <CheckCircle2 className="w-8 h-8 text-blue-600 mx-auto mb-2" />
                          <p className="font-semibold text-sm mb-1">Completeness</p>
                          <span className={`text-3xl font-bold ${
                            complianceResults.quality_analysis.completeness_score >= 90 ? 'text-green-600' :
                            complianceResults.quality_analysis.completeness_score >= 75 ? 'text-yellow-600' :
                            'text-red-600'
                          }`}>
                            {complianceResults.quality_analysis.completeness_score}%
                          </span>
                          <p className="text-xs text-gray-600 mt-1">Documentation complete</p>
                        </div>
                      </CardContent>
                    </Card>
                  </>
                )}
              </div>

              {/* Quality Feedback */}
              {complianceResults?.quality_analysis?.suggestions?.length > 0 && (
                <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5 text-purple-600" />
                      Documentation Quality Improvements
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {complianceResults.quality_analysis.suggestions.map((suggestion, idx) => (
                      <div key={idx} className="bg-white dark:bg-slate-900 p-3 rounded-lg border border-purple-200">
                        <div className="flex items-start gap-2 mb-2">
                          <Badge className={
                            suggestion.severity === 'critical' ? 'bg-red-600' :
                            suggestion.severity === 'important' ? 'bg-orange-500' :
                            'bg-blue-500'
                          }>
                            {suggestion.severity}
                          </Badge>
                          <Badge variant="outline">{suggestion.category?.replace(/_/g, ' ')}</Badge>
                        </div>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
                          {suggestion.issue}
                        </p>
                        <div className="bg-blue-50 dark:bg-blue-900 p-2 rounded">
                          <p className="text-xs text-blue-800 dark:text-blue-300">
                            <strong>Recommendation:</strong> {suggestion.recommendation}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Medicare Violations */}
              {medicareViolations && medicareViolations.length > 0 &&
            <Card className="border-red-300 bg-red-50 dark:bg-red-950">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-red-800 dark:text-red-400">
                      <ShieldAlert className="w-5 h-5" />
                      Medicare Compliance Violations ({medicareViolations.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {medicareViolations.map((violation, idx) =>
                <div key={idx} className="bg-white dark:bg-gray-900 p-3 rounded-lg border-l-4 border-red-600">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="font-semibold text-sm text-red-800 dark:text-red-400">{violation.violation}</p>
                          <Badge className={
                    violation.severity === 'critical' ? 'bg-red-700' :
                    violation.severity === 'high' ? 'bg-orange-600' :
                    'bg-yellow-600'
                    }>
                            {violation.severity}
                          </Badge>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                          <strong>42 CFR Reference:</strong> {violation.cop_reference}
                        </p>
                        <div className="bg-green-50 dark:bg-green-900 p-2 rounded">
                          <p className="text-xs font-medium text-green-800 dark:text-green-300">
                            <strong>How to Fix:</strong> {violation.remediation}
                          </p>
                        </div>
                      </div>
                )}
                  </CardContent>
                </Card>
            }

              {/* Regulatory Warnings */}
              {regulatoryWarnings && regulatoryWarnings.length > 0 &&
            <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-400">
                      <AlertTriangle className="w-5 h-5" />
                      Regulatory Warnings ({regulatoryWarnings.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {regulatoryWarnings.map((warning, idx) =>
                  <div key={idx} className="p-2 bg-white dark:bg-gray-900 rounded border-l-2 border-orange-500">
                          <p className="text-sm text-orange-800 dark:text-orange-300">{warning}</p>
                        </div>
                  )}
                    </div>
                  </CardContent>
                </Card>
            }

              {/* Compliance Results */}
              {complianceResults &&
            <Card className={
            complianceResults.status === 'passed' ? 'border-green-300 bg-green-50 dark:bg-green-950' :
            complianceResults.status === 'critical' ? 'border-red-300 bg-red-50 dark:bg-red-950' :
            'border-yellow-300 bg-yellow-50 dark:bg-yellow-950'
            }>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Documentation Analysis</span>
                      <Badge className={
                  complianceResults.compliance_score >= 90 ? 'bg-green-600' :
                  complianceResults.compliance_score >= 70 ? 'bg-yellow-600' :
                  'bg-red-600'
                  }>
                        {complianceResults.status.toUpperCase()}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {complianceResults.compliant_elements?.length > 0 &&
                <div>
                        <h5 className="font-semibold text-green-800 dark:text-green-400 mb-2">✓ Compliant Elements</h5>
                        <ul className="space-y-1">
                          {complianceResults.compliant_elements.map((element, idx) =>
                    <li key={idx} className="text-sm text-green-700 dark:text-green-300">• {element}</li>
                    )}
                        </ul>
                      </div>
                }

                    {complianceResults.issues?.length > 0 &&
                <div>
                        <h5 className="font-semibold text-red-800 dark:text-red-400 mb-2">⚠ Issues Found</h5>
                        <div className="space-y-3">
                          {complianceResults.issues.map((issue, idx) =>
                    <div key={idx} className="bg-white dark:bg-gray-900 p-3 rounded border border-red-200">
                              <div className="flex items-start gap-2 mb-1">
                                <Badge className={
                        issue.severity === 'critical' ? 'bg-red-600' :
                        issue.severity === 'high' ? 'bg-orange-500' :
                        'bg-yellow-500'
                        }>
                                  {issue.severity}
                                </Badge>
                                <p className="font-medium text-sm">{issue.element}</p>
                              </div>
                              <p className="text-sm text-red-700 dark:text-red-300 mb-2">{issue.problem}</p>
                              <p className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900 p-2 rounded">
                                💡 {issue.suggestion}
                              </p>
                            </div>
                    )}
                        </div>
                      </div>
                }
                  </CardContent>
                </Card>
            }

              {/* Suggested Tasks */}
              {suggestedTasks && suggestedTasks.length > 0 &&
            <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ListTodo className="w-5 h-5 text-blue-600" />
                      Suggested Follow-Up Tasks ({suggestedTasks.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {suggestedTasks.map((task, idx) =>
                <div key={idx} className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold text-slate-900 dark:text-slate-100">{task.title}</h4>
                              <Badge className={
                        task.priority === 'critical' ? 'bg-red-600' :
                        task.priority === 'high' ? 'bg-orange-500' :
                        task.priority === 'medium' ? 'bg-yellow-500' :
                        'bg-blue-500'
                        }>
                                {task.priority}
                              </Badge>
                              <Badge variant="outline">{task.type}</Badge>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{task.description}</p>
                            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-500">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {task.suggested_due_timeframe?.replace('_', ' ') || 'No deadline'}
                              </span>
                            </div>
                            {task.ai_reason &&
                      <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-800 rounded text-xs text-slate-600 dark:text-slate-400">
                                <strong>Why:</strong> {task.ai_reason}
                              </div>
                      }
                          </div>
                          <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const dueDate = (() => {
                            const today = new Date();
                            switch (task.suggested_due_timeframe) {
                              case 'today':return today.toISOString().split('T')[0];
                              case '24_hours':
                                today.setDate(today.getDate() + 1);
                                return today.toISOString().split('T')[0];
                              case '48_hours':
                                today.setDate(today.getDate() + 2);
                                return today.toISOString().split('T')[0];
                              case 'this_week':
                                today.setDate(today.getDate() + 7);
                                return today.toISOString().split('T')[0];
                              default:return null;
                            }
                          })();

                          await base44.entities.Task.create({
                            title: task.title,
                            description: task.description,
                            priority: task.priority,
                            type: task.type,
                            due_date: dueDate,
                            due_timeframe: task.suggested_due_timeframe,
                            patient_id: selectedPatient !== 'no_patient' ? selectedPatient : null,
                            assigned_to: currentUser?.email,
                            source: 'ai_generated',
                            ai_reason: task.ai_reason,
                            status: 'pending'
                          });
                          toast.success('Task added to your list');
                          setSuggestedTasks((prev) => prev.filter((_, i) => i !== idx));
                        } catch (error) {
                          toast.error('Failed to add task');
                          console.error(error);
                        }
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white">

                            <Plus className="w-4 h-4 mr-1" />
                            Add Task
                          </Button>
                        </div>
                      </div>
                )}
                  </CardContent>
                </Card>
            }

              {/* AI Auto-Populate & Follow-Up Tasks */}
              {currentUser?.service_type !== 'home_health' && currentUser?.service_type !== 'hospice' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                <AutoPopulateDataFields
                narrative={enhancedNote || roughNotes}
                dataType="vital_signs"
                patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                visitType={visitType}
                onDataExtracted={(data) => {
                  console.log('Extracted vital signs:', data);
                }} />

                <AIFollowUpTasksGenerator
                visitId={null}
                patientId={selectedPatient !== 'no_patient' ? selectedPatient : null}
                patientName={patientData ? `${patientData.first_name} ${patientData.last_name}` : 'Patient'}
                visitNotes={enhancedNote}
                vitalSigns={extractedData?.vitals} />

              </div>
              )}

              {/* ICD-10 Code Suggestions */}
              <EnhancedICD10Suggester 
                clinicalNote={enhancedNote}
                diagnosis={selectedDiagnosis}
                customRules={customComplianceRules}
              />

              {/* Care Plan Suggestions */}
              {patientData && (currentUser?.credential_type === 'RN' || currentUser?.credential_type === 'MSW') &&
            <CarePlanSuggestionsPanel
              patientId={patientData.id}
              visitType={visitType}
              diagnosis={selectedDiagnosis}
              noteContent={enhancedNote} />

            }

              {/* Start Over Button */}
              <Button
              onClick={() => {
                setShowResults(false);
                setEnhancedNote(null);
                setComplianceResults(null);
                setMedicareViolations([]);
                setRegulatoryWarnings([]);
                setSuggestedTasks([]);
                setRoughNotes("");
              }}
              variant="outline"
              className="w-full">

                Create Another Note
              </Button>
            </div>
          </>
        }

        {/* Create Patient Dialog */}
        {(showCreatePatient || selectedPatient === "create_new") &&
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <Card className="w-full max-w-md mx-4">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Create New Patient</CardTitle>
                  <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setShowCreatePatient(false);
                    setSelectedPatient("no_patient");
                  }}>

                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>First Name *</Label>
                  <Input
                  value={newPatientData.first_name}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    first_name: e.target.value
                  })
                  }
                  placeholder="John" />

                </div>
                <div>
                  <Label>Last Name *</Label>
                  <Input
                  value={newPatientData.last_name}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    last_name: e.target.value
                  })
                  }
                  placeholder="Doe" />

                </div>
                <div>
                  <Label>Date of Birth</Label>
                  <Input
                  type="date"
                  value={newPatientData.date_of_birth}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    date_of_birth: e.target.value
                  })
                  } />

                </div>
                <div>
                  <Label>Medical Record Number</Label>
                  <Input
                  value={newPatientData.medical_record_number}
                  onChange={(e) =>
                  setNewPatientData({
                    ...newPatientData,
                    medical_record_number: e.target.value
                  })
                  }
                  placeholder="MRN-12345" />

                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowCreatePatient(false);
                    setSelectedPatient("no_patient");
                  }}>

                    Cancel
                  </Button>
                  <Button
                  className="flex-1"
                  onClick={createNewPatient}
                  disabled={creatingPatient}>

                    {creatingPatient ?
                  <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </> :

                  "Create Patient"
                  }
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        }
                    </div>
                    </div>);

}