import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  CheckCircle2,
  Edit,
  Save,
  Flag,
  Eye,
  EyeOff,
  XCircle,
  RotateCcw,
  Info
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function OASISPDFComparison({ 
  uploadedFileUrl, 
  extractedData, 
  pdgmData,
  oasisUploadId,
  onDataCorrected 
}) {
  const [editingField, setEditingField] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [discrepancies, setDiscrepancies] = useState([]);
  const [showPDF, setShowPDF] = useState(true);
  const queryClient = useQueryClient();

  // Initialize edit values from extracted data
  React.useEffect(() => {
    if (extractedData && pdgmData) {
      const initialValues = {
        // Patient Info
        patient_name: pdgmData?.patient_info?.name || '',
        patient_dob: pdgmData?.patient_info?.dob || '',
        patient_gender: pdgmData?.patient_info?.gender || '',
        patient_address: pdgmData?.patient_info?.address || '',
        
        // Assessment Info
        assessment_date: pdgmData?.patient_info?.assessment_date || '',
        assessment_type: pdgmData?.patient_info?.assessment_type || '',
        
        // Diagnoses
        primary_diagnosis_code: pdgmData?.primary_diagnosis_code || '',
        primary_diagnosis_description: pdgmData?.primary_diagnosis_description || '',
        
        // Functional Scores
        m1800_grooming: pdgmData?.functional_scores?.m1800_grooming ?? '',
        m1810_dress_upper: pdgmData?.functional_scores?.m1810_dress_upper ?? '',
        m1820_dress_lower: pdgmData?.functional_scores?.m1820_dress_lower ?? '',
        m1830_bathing: pdgmData?.functional_scores?.m1830_bathing ?? '',
        m1840_toilet_transfer: pdgmData?.functional_scores?.m1840_toilet_transfer ?? '',
        m1850_transferring: pdgmData?.functional_scores?.m1850_transferring ?? '',
        m1860_ambulation: pdgmData?.functional_scores?.m1860_ambulation ?? '',
        
        // Episode Timing
        episode_timing: pdgmData?.episode_timing || '',
        m0110_episode_timing: pdgmData?.m0110_episode_timing || '',
        
        // Clinical Items
        m1400_dyspnea: pdgmData?.clinical_items?.dyspnea ?? '',
        m1242_pain_freq: pdgmData?.clinical_items?.pain_frequency ?? '',
      };
      setEditValues(initialValues);
    }
  }, [extractedData, pdgmData]);

  // Save discrepancy flag
  const flagDiscrepancyMutation = useMutation({
    mutationFn: async (discrepancy) => {
      return await base44.entities.OASISFeedback.create({
        oasis_upload_id: oasisUploadId,
        feedback_type: 'incorrect_match',
        extracted_name: pdgmData?.patient_info?.name,
        extracted_medicare_id: pdgmData?.patient_info?.medicare_id,
        extracted_dob: pdgmData?.patient_info?.dob,
        user_notes: discrepancy.notes,
        match_factors_used: [discrepancy.field]
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisFeedback'] });
    }
  });

  const handleFlagDiscrepancy = (field, originalValue, correctedValue) => {
    const discrepancy = {
      field,
      originalValue,
      correctedValue,
      timestamp: new Date().toISOString(),
      notes: `Field ${field} was incorrect. Original: "${originalValue}", Corrected: "${correctedValue}"`
    };
    
    setDiscrepancies(prev => [...prev, discrepancy]);
    flagDiscrepancyMutation.mutate(discrepancy);
  };

  const handleSaveField = (fieldKey) => {
    const newValue = editValues[fieldKey];
    const oldValue = getFieldValue(fieldKey);
    
    if (newValue !== oldValue) {
      handleFlagDiscrepancy(fieldKey, oldValue, newValue);
      
      // Update the parent component
      if (onDataCorrected) {
        onDataCorrected({ [fieldKey]: newValue });
      }
    }
    
    setEditingField(null);
  };

  const getFieldValue = (fieldKey) => {
    const path = fieldKey.split('.');
    let value = pdgmData;
    
    for (const key of path) {
      value = value?.[key];
    }
    
    return value ?? editValues[fieldKey] ?? '';
  };

  const renderEditableField = (label, fieldKey, type = 'text') => {
    const isEditing = editingField === fieldKey;
    const currentValue = editValues[fieldKey] ?? '';
    const hasDiscrepancy = discrepancies.some(d => d.field === fieldKey);

    return (
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <Label className="text-sm font-medium text-slate-700">{label}</Label>
          <div className="flex items-center gap-1">
            {hasDiscrepancy && (
              <Badge className="bg-yellow-600 text-white text-xs">
                <Flag className="w-3 h-3 mr-1" />
                Flagged
              </Badge>
            )}
            {!isEditing ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingField(fieldKey)}
                className="h-7 px-2"
              >
                <Edit className="w-3 h-3" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSaveField(fieldKey)}
                  className="h-7 px-2 text-green-600 hover:text-green-700"
                >
                  <Save className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingField(null);
                    setEditValues(prev => ({ ...prev, [fieldKey]: getFieldValue(fieldKey) }));
                  }}
                  className="h-7 px-2 text-red-600 hover:text-red-700"
                >
                  <XCircle className="w-3 h-3" />
                </Button>
              </>
            )}
          </div>
        </div>
        {isEditing ? (
          <Input
            type={type}
            value={currentValue}
            onChange={(e) => setEditValues(prev => ({ ...prev, [fieldKey]: e.target.value }))}
            className="text-sm"
            autoFocus
          />
        ) : (
          <div className={`p-2 bg-slate-50 rounded border ${hasDiscrepancy ? 'border-yellow-400 bg-yellow-50' : 'border-slate-200'}`}>
            <p className="text-sm text-slate-900">
              {currentValue || <span className="text-slate-400 italic">No value</span>}
            </p>
          </div>
        )}
      </div>
    );
  };

  const clearAllDiscrepancies = () => {
    setDiscrepancies([]);
  };

  if (!uploadedFileUrl || !pdgmData) {
    return null;
  }

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-navy-600" />
            Side-by-Side PDF Comparison & Validation
          </CardTitle>
          <div className="flex items-center gap-2">
            {discrepancies.length > 0 && (
              <Badge className="bg-yellow-600 text-white">
                {discrepancies.length} flagged
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPDF(!showPDF)}
            >
              {showPDF ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
              {showPDF ? 'Hide' : 'Show'} PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Alert className="mb-4 bg-navy-50 border-navy-200">
          <Info className="w-4 h-4 text-navy-600" />
          <AlertDescription className="text-navy-900">
            <p className="font-semibold mb-1">Interactive Data Validation</p>
            <p className="text-sm">
              Review the extracted data against the original PDF. Click <Edit className="w-3 h-3 inline" /> to edit any field, 
              then <Save className="w-3 h-3 inline" /> to save corrections. All changes are automatically flagged for quality improvement.
            </p>
          </AlertDescription>
        </Alert>

        {/* Discrepancies Summary */}
        {discrepancies.length > 0 && (
          <Alert className="mb-4 bg-yellow-50 border-yellow-300">
            <Flag className="w-4 h-4 text-yellow-600" />
            <AlertDescription>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-yellow-900 mb-1">
                    {discrepancies.length} discrepanc{discrepancies.length === 1 ? 'y' : 'ies'} flagged
                  </p>
                  <p className="text-xs text-yellow-800">
                    Your corrections help improve AI extraction accuracy
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearAllDiscrepancies}
                  className="text-yellow-700"
                >
                  <RotateCcw className="w-3 h-3 mr-1" />
                  Clear Flags
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* PDF Viewer */}
          {showPDF && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Original PDF Document</h3>
                <Badge variant="outline">Source</Badge>
              </div>
              <div className="border-2 border-slate-300 rounded-lg overflow-hidden bg-slate-100">
                <iframe
                  src={uploadedFileUrl}
                  className="w-full h-[800px]"
                  title="OASIS PDF"
                />
              </div>
            </div>
          )}

          {/* Extracted Data Editor */}
          <div className={showPDF ? '' : 'lg:col-span-2'}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-700">Extracted Data (Editable)</h3>
              <Badge variant="outline" className="bg-blue-50 text-blue-700">
                AI Extracted
              </Badge>
            </div>
            
            <Tabs defaultValue="demographics" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="demographics">Patient</TabsTrigger>
                <TabsTrigger value="diagnoses">Diagnoses</TabsTrigger>
                <TabsTrigger value="functional">Functional</TabsTrigger>
                <TabsTrigger value="clinical">Clinical</TabsTrigger>
              </TabsList>

              {/* Patient Demographics Tab */}
              <TabsContent value="demographics" className="space-y-2 mt-4">
                <div className="bg-white p-4 rounded-lg border">
                  {renderEditableField('Patient Name', 'patient_name')}
                  {renderEditableField('Date of Birth', 'patient_dob', 'date')}
                  {renderEditableField('Gender', 'patient_gender')}
                  {renderEditableField('Address', 'patient_address')}
                  {renderEditableField('Assessment Date', 'assessment_date', 'date')}
                  {renderEditableField('Assessment Type', 'assessment_type')}
                </div>
              </TabsContent>

              {/* Diagnoses Tab */}
              <TabsContent value="diagnoses" className="space-y-2 mt-4">
                <div className="bg-white p-4 rounded-lg border">
                  {renderEditableField('Primary Diagnosis Code (M1021)', 'primary_diagnosis_code')}
                  {renderEditableField('Primary Diagnosis Description', 'primary_diagnosis_description')}
                  
                  {/* Comorbidities List */}
                  <div className="mt-4">
                    <Label className="text-sm font-medium text-slate-700 mb-2 block">
                      Other Diagnoses (M1023)
                    </Label>
                    {pdgmData?.comorbidities?.length > 0 ? (
                      <div className="space-y-2">
                        {pdgmData.comorbidities.map((comorbidity, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 rounded border">
                            <Badge variant="outline" className="text-xs">{idx + 1}</Badge>
                            <span className="text-sm flex-1">{comorbidity}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 italic">No comorbidities extracted</p>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Functional Scores Tab */}
              <TabsContent value="functional" className="space-y-2 mt-4">
                <div className="bg-white p-4 rounded-lg border">
                  <div className="grid grid-cols-2 gap-4">
                    {renderEditableField('M1800 Grooming', 'm1800_grooming', 'number')}
                    {renderEditableField('M1810 Upper Dress', 'm1810_dress_upper', 'number')}
                    {renderEditableField('M1820 Lower Dress', 'm1820_dress_lower', 'number')}
                    {renderEditableField('M1830 Bathing', 'm1830_bathing', 'number')}
                    {renderEditableField('M1840 Toilet Transfer', 'm1840_toilet_transfer', 'number')}
                    {renderEditableField('M1850 Transferring', 'm1850_transferring', 'number')}
                    {renderEditableField('M1860 Ambulation', 'm1860_ambulation', 'number')}
                  </div>
                  
                  {/* Functional Score Summary */}
                  <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-2">Functional Impairment Level</p>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-center p-2 bg-white rounded">
                        <p className="text-xs text-slate-500">Low (0)</p>
                        <p className="text-sm font-bold text-green-600">
                          {Object.values(pdgmData?.functional_scores || {}).filter(v => v === 0).length}
                        </p>
                      </div>
                      <div className="text-center p-2 bg-white rounded">
                        <p className="text-xs text-slate-500">Med (1-2)</p>
                        <p className="text-sm font-bold text-yellow-600">
                          {Object.values(pdgmData?.functional_scores || {}).filter(v => v >= 1 && v <= 2).length}
                        </p>
                      </div>
                      <div className="text-center p-2 bg-white rounded">
                        <p className="text-xs text-slate-500">High (3+)</p>
                        <p className="text-sm font-bold text-red-600">
                          {Object.values(pdgmData?.functional_scores || {}).filter(v => v >= 3).length}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Clinical Items Tab */}
              <TabsContent value="clinical" className="space-y-2 mt-4">
                <div className="bg-white p-4 rounded-lg border">
                  {renderEditableField('Episode Timing', 'episode_timing')}
                  {renderEditableField('M0110 Episode Timing', 'm0110_episode_timing')}
                  {renderEditableField('M1400 Dyspnea', 'm1400_dyspnea', 'number')}
                  {renderEditableField('M1242 Pain Frequency', 'm1242_pain_freq', 'number')}
                  
                  {/* Wound Status */}
                  <div className="mt-4 p-3 bg-slate-50 rounded border">
                    <p className="text-xs font-semibold text-slate-700 mb-2">Wound Status</p>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Pressure Ulcer:</span>
                        <Badge variant={pdgmData?.clinical_items?.pressure_ulcer_present ? 'destructive' : 'outline'}>
                          {pdgmData?.clinical_items?.pressure_ulcer_present ? 'Yes' : 'No'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Stasis Ulcer:</span>
                        <Badge variant={pdgmData?.clinical_items?.stasis_ulcer ? 'destructive' : 'outline'}>
                          {pdgmData?.clinical_items?.stasis_ulcer ? 'Yes' : 'No'}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Surgical Wound:</span>
                        <Badge variant={pdgmData?.clinical_items?.surgical_wound ? 'destructive' : 'outline'}>
                          {pdgmData?.clinical_items?.surgical_wound ? 'Yes' : 'No'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Discrepancies Log */}
        {discrepancies.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Flag className="w-4 h-4 text-yellow-600" />
              Correction History ({discrepancies.length})
            </h3>
            <div className="space-y-2">
              {discrepancies.map((disc, idx) => (
                <div key={idx} className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900 mb-1">{disc.field}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-xs text-red-600">Original:</p>
                          <p className="text-sm text-red-800">{disc.originalValue || 'Empty'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-green-600">Corrected:</p>
                          <p className="text-sm text-green-800">{disc.correctedValue}</p>
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {new Date(disc.timestamp).toLocaleTimeString()}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap gap-2 justify-end">
          <Button
            variant="outline"
            onClick={clearAllDiscrepancies}
            disabled={discrepancies.length === 0}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Clear Flags
          </Button>
          <Button
            onClick={() => {
              if (onDataCorrected) {
                onDataCorrected(editValues);
              }
            }}
            className="bg-navy-600 hover:bg-navy-700"
            disabled={discrepancies.length === 0}
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Apply All Corrections
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}