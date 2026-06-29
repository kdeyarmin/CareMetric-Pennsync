import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw,
  UserPlus,
  UserCheck,
  UserX,
  Loader2,
  ArrowRight,
  AlertTriangle,
  Settings
} from "lucide-react";

// MRN-ONLY duplicate matching.
// Imports deliberately match on Medical Record Number only: fuzzy matching on
// uploaded data is too risky to auto-update/close existing records, so this
// surface intentionally does NOT use the shared fuzzy scorer.
const calculateMatchScore = (patient, existingPatient, _sensitivity = 'medium', _criteria = {}) => {
  let score = 0;
  let matches = [];
  const criteriaMatched = {};

  // MEDICAL RECORD NUMBER MATCHING ONLY
  if (patient.medical_record_number && existingPatient.medical_record_number) {
    const normalizeMRN = (mrn) => String(mrn).trim().replace(/\s+/g, '').toUpperCase();
    const mrn1 = normalizeMRN(patient.medical_record_number);
    const mrn2 = normalizeMRN(existingPatient.medical_record_number);
    
    if (mrn1 === mrn2) {
      score = 100; // Maximum score for MRN match - definitive match
      matches.push('✓ MRN EXACT MATCH - SAME PATIENT');
      criteriaMatched.mrn = true;
      criteriaMatched.definitive = true;
    }
  }

  // No match if MRN doesn't match
  const confidenceLevel = criteriaMatched.definitive ? 'definitive' : 'no_match';

  return { score, matches, confidenceLevel, criteriaMatched };
};

const findDuplicates = (patient, existingPatients, sensitivity = 'medium', threshold = null, criteria = {}) => {
  const potentialDuplicates = [];
  
  // Sensitivity-based thresholds
  const defaultThresholds = {
    strict: 60,
    medium: 40,
    loose: 25
  };
  
  const minScore = threshold !== null ? threshold : defaultThresholds[sensitivity] || 40;

  existingPatients.forEach(existing => {
    const { score, matches, confidenceLevel, criteriaMatched } = calculateMatchScore(patient, existing, sensitivity, criteria);
    
    if (score >= minScore) {
      potentialDuplicates.push({
        patient: existing,
        score,
        matches,
        confidenceLevel,
        criteriaMatched,
        criteriaMet: Object.keys(criteriaMatched).length
      });
    }
  });

  return potentialDuplicates.sort((a, b) => b.score - a.score);
};

// Compare patient data and identify differences
const comparePatients = (importedPatient, existingPatient) => {
  const differences = [];
  const fields = [
    'first_name', 'last_name', 'middle_name', 'date_of_birth', 
    'medical_record_number', 'phone', 'email', 'address',
    'primary_diagnosis', 'physician_name', 'physician_phone',
    'emergency_contact_name', 'emergency_contact_phone', 'status',
    'care_type', 'admission_date'
  ];

  fields.forEach(field => {
    const importedValue = importedPatient[field];
    const existingValue = existingPatient[field];
    
    // Normalize for comparison
    const normalize = (val) => {
      if (!val) return '';
      return String(val).toLowerCase().trim();
    };
    
    const normalizedImported = normalize(importedValue);
    const normalizedExisting = normalize(existingValue);
    
    if (normalizedImported && normalizedImported !== normalizedExisting) {
      differences.push({
        field,
        importedValue: importedValue || '',
        existingValue: existingValue || 'Not set',
        isNew: !existingValue,
        isUpdate: !!existingValue && normalizedImported !== normalizedExisting
      });
    }
  });
  
  return differences;
};

export default function DuplicateDetector({ patients, onResolve }) {
  const [resolution, setResolution] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [sensitivity, setSensitivity] = useState('medium');
  const [customThreshold, setCustomThreshold] = useState(40);
  const [showSettings, setShowSettings] = useState(false);
  const [matchingCriteria, _setMatchingCriteria] = useState({
    mrn: true,
    nameAndDob: true,
    phoneAndLastName: true,
    emailAndLastName: false,
    address: true
  });
  const [autoResolveStrategy, setAutoResolveStrategy] = useState('merge'); // Default to auto-merge for MRN matches

  const { data: existingPatients = [], isLoading } = useQuery({
    queryKey: ['all-patients-duplicate-check'],
    queryFn: async () => {
      // Fetch all patients including active and discharged to check against all records
      const allPatients = await base44.entities.Patient.list('-created_date', 10000);
      return allPatients;
    }
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-sm text-slate-600">Checking for duplicate patients...</p>
        </CardContent>
      </Card>
    );
  }

  // Find duplicates for each patient and analyze differences
  const duplicateAnalysis = patients.map((patient, idx) => {
    const duplicates = findDuplicates(patient, existingPatients, sensitivity, customThreshold, matchingCriteria).map(dup => ({
      ...dup,
      differences: comparePatients(patient, dup.patient)
    }));
    
    // Auto-set resolution based on strategy
    let autoResolution = resolution[idx] || null;
    if (!autoResolution && duplicates.length > 0 && autoResolveStrategy !== 'manual') {
      const topMatch = duplicates[0];
      
      if (autoResolveStrategy === 'merge' && topMatch.confidenceLevel === 'definitive') {
        // Auto-update for MRN matches only if there are differences to update
        if (topMatch.differences.length > 0) {
          autoResolution = { action: 'update', existingPatientId: topMatch.patient.id, auto: true };
        } else {
          // MRN match but no differences - skip this row
          autoResolution = { action: 'skip', auto: true };
        }
      } else if (autoResolveStrategy === 'manual') {
        // Manual review - don't auto-select
        autoResolution = null;
      }
    }
    
    return {
      index: idx,
      patient,
      duplicates,
      resolution: autoResolution
    };
  });

  const patientsWithDuplicates = duplicateAnalysis.filter(p => p.duplicates.length > 0);
  const patientsWithoutDuplicates = duplicateAnalysis.filter(p => p.duplicates.length === 0);

  const handleSetResolution = (index, action, existingPatientId = null) => {
    setResolution(prev => ({
      ...prev,
      [index]: { action, existingPatientId }
    }));
  };

  const handleApplyResolutions = async () => {
    setIsProcessing(true);
    
    const results = {
      added: [],
      updated: [],
      closed: [],
      skipped: []
    };

    for (const analysis of duplicateAnalysis) {
      const res = resolution[analysis.index];
      
      if (!res) {
        // No resolution set - default to add if no duplicates
        if (analysis.duplicates.length === 0) {
          results.added.push(analysis.patient);
        } else {
          results.skipped.push(analysis.patient);
        }
        continue;
      }

      switch (res.action) {
        case 'add':
          results.added.push(analysis.patient);
          break;
        case 'update':
          results.updated.push({
            id: res.existingPatientId,
            data: analysis.patient
          });
          break;
        case 'close':
          results.closed.push(res.existingPatientId);
          break;
        case 'skip':
          results.skipped.push(analysis.patient);
          break;
      }
    }

    // Batch operations for efficiency and rate limit prevention
    onResolve(results);
    setIsProcessing(false);
  };

  const allResolved = duplicateAnalysis.every(p => 
    resolution[p.index] || p.duplicates.length === 0
  );

  const getConfidenceBadgeColor = (level) => {
    switch (level) {
      case 'definitive':
        return 'bg-navy-100 text-navy-900 border-navy-400';
      case 'very_high':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'high':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getConfidenceLabel = (level) => {
    switch (level) {
      case 'definitive':
        return '✓ DEFINITIVE MATCH';
      case 'very_high':
        return 'Very High Confidence';
      case 'high':
        return 'High Confidence';
      case 'medium':
        return 'Medium Confidence';
      default:
        return 'Low Confidence';
    }
  };

  return (
    <div className="space-y-4">
      {/* Sensitivity Configuration */}
      <Card className="border-2 border-blue-300 bg-blue-50">
        <CardHeader 
          className="cursor-pointer hover:bg-blue-100 transition-colors"
          onClick={() => setShowSettings(!showSettings)}
        >
          <CardTitle className="flex items-center justify-between text-blue-900">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Duplicate Detection Settings
            </div>
            <Badge className="bg-blue-200 text-blue-900">
              {sensitivity.charAt(0).toUpperCase() + sensitivity.slice(1)} Sensitivity
            </Badge>
          </CardTitle>
        </CardHeader>
        {showSettings && (
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">Detection Sensitivity</Label>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Button
                  variant={sensitivity === 'strict' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setSensitivity('strict'); setCustomThreshold(60); }}
                  className={sensitivity === 'strict' ? 'bg-blue-600' : ''}
                >
                  Strict
                </Button>
                <Button
                  variant={sensitivity === 'medium' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setSensitivity('medium'); setCustomThreshold(40); }}
                  className={sensitivity === 'medium' ? 'bg-blue-600' : ''}
                >
                  Medium
                </Button>
                <Button
                  variant={sensitivity === 'loose' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setSensitivity('loose'); setCustomThreshold(25); }}
                  className={sensitivity === 'loose' ? 'bg-blue-600' : ''}
                >
                  Loose
                </Button>
              </div>
              <div className="text-xs text-slate-600 space-y-1 bg-white p-3 rounded-lg border">
               <p><strong>MRN-Only Matching:</strong> Duplicates are detected ONLY by matching Medical Record Number (MRN)</p>
               <p><strong>Auto-Update:</strong> When MRN matches, the existing patient record will be updated with new information from the upload</p>
               <p>Sensitivity settings do not affect MRN matching - exact match required</p>
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Custom Threshold: {customThreshold}%
              </Label>
              <Slider
                value={[customThreshold]}
                onValueChange={(value) => setCustomThreshold(value[0])}
                min={20}
                max={80}
                step={5}
                className="mb-2"
              />
              <p className="text-xs text-slate-600">
                Matches scoring {customThreshold}% or higher will be flagged as potential duplicates
              </p>
            </div>

            <Alert className="bg-navy-50 border-navy-300">
              <AlertDescription className="text-xs text-navy-900">
                <strong>MRN-Only Matching:</strong> Duplicates are identified exclusively by Medical Record Number (MRN). 
                When an MRN match is found, the existing patient record will be automatically updated with any new information from the upload file.
              </AlertDescription>
            </Alert>

            <div className="border-t pt-4">
              <Label className="text-sm font-medium mb-3 block">Automatic Resolution Strategy</Label>
              <div className="space-y-2">
                <label htmlFor="auto-resolve-merge" className="flex items-center gap-2 cursor-pointer">
                  <input
                    id="auto-resolve-merge"
                    type="radio"
                    name="autoResolve"
                    checked={autoResolveStrategy === 'merge'}
                    onChange={() => setAutoResolveStrategy('merge')}
                    className="rounded-full"
                  />
                  <div className="text-sm font-medium">
                    Auto-Update (Recommended)
                    <p className="text-xs font-normal text-slate-600">Automatically update existing records when MRN matches</p>
                  </div>
                </label>
                <label htmlFor="auto-resolve-manual" className="flex items-center gap-2 cursor-pointer">
                  <input
                    id="auto-resolve-manual"
                    type="radio"
                    name="autoResolve"
                    checked={autoResolveStrategy === 'manual'}
                    onChange={() => setAutoResolveStrategy('manual')}
                    className="rounded-full"
                  />
                  <div className="text-sm font-medium">
                    Manual Review
                    <p className="text-xs font-normal text-slate-600">Review each MRN match manually before updating</p>
                  </div>
                </label>
              </div>
            </div>

            <Alert className="bg-blue-100 border-blue-300">
              <AlertDescription className="text-xs text-blue-900">
                💡 <strong>Recommended:</strong> Auto-Update mode will automatically update patient records when MRN matches are found, preserving all new information from the upload.
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      <Card className="border-2 border-orange-300">
        <CardHeader className="bg-orange-50">
          <CardTitle className="flex items-center gap-2 text-orange-900">
            <AlertCircle className="w-6 h-6" />
            Duplicate Detection Results (MRN-Priority Matching)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-green-700 mb-1">No Duplicates Found</p>
              <p className="text-2xl font-bold text-green-900">{patientsWithoutDuplicates.length}</p>
            </div>
            <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
              <p className="text-sm text-orange-700 mb-1">Possible Duplicates</p>
              <p className="text-2xl font-bold text-orange-900">{patientsWithDuplicates.length}</p>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-700 mb-1">Resolved</p>
              <p className="text-2xl font-bold text-blue-900">
                {Object.keys(resolution).length + patientsWithoutDuplicates.length}
              </p>
            </div>
          </div>

          {patientsWithoutDuplicates.length > 0 && (
            <Alert className="bg-green-50 border-green-200 mb-4">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                {patientsWithoutDuplicates.length} patient(s) have no duplicates and will be added automatically.
              </AlertDescription>
            </Alert>
          )}

          {patientsWithDuplicates.length > 0 && (
            <>
              <Alert className="bg-orange-50 border-orange-200 mb-4">
                <AlertCircle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-orange-900">
                  {patientsWithDuplicates.length} patient(s) have potential duplicates. Review each one and choose an action.
                </AlertDescription>
              </Alert>

              <ScrollArea className="h-96">
                <div className="space-y-4 pr-4">
                  {patientsWithDuplicates.map(({ index, patient, duplicates }) => (
                    <Card key={index} className="border-2 border-orange-200">
                      <CardContent className="p-4">
                        <div className="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                          <h4 className="font-semibold text-slate-900 mb-2">
                            Import Row {index + 1}: {patient.first_name} {patient.last_name}
                          </h4>
                          <div className="text-sm text-slate-700 space-y-1">
                            <div>DOB: {patient.date_of_birth || 'N/A'} | MRN: {patient.medical_record_number || 'N/A'}</div>
                            {patient.phone && <div>Phone: {patient.phone}</div>}
                            {patient.address && <div>Address: {patient.address}</div>}
                            {patient.primary_diagnosis && <div>Diagnosis: {patient.primary_diagnosis}</div>}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <p className="text-sm font-medium text-orange-900">
                            {duplicates.length} potential duplicate(s) found:
                          </p>
                          
                          {duplicates.map((dup, dupIdx) => (
                            <Card key={dupIdx} className="bg-slate-50">
                              <CardContent className="p-3">
                                <div className="flex items-start justify-between mb-2">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                      <p className="font-medium text-slate-900">
                                        Existing: {dup.patient.first_name} {dup.patient.last_name}
                                      </p>
                                      <Badge variant="outline" className={
                                        dup.patient.status === 'active' ? 'bg-green-100 text-green-800 text-xs' :
                                        dup.patient.status === 'discharged' ? 'bg-slate-100 text-slate-800 text-xs' :
                                        'bg-orange-100 text-orange-800 text-xs'
                                      }>
                                        {dup.patient.status || 'unknown'}
                                      </Badge>
                                      <Badge className={`text-xs border ${getConfidenceBadgeColor(dup.confidenceLevel)}`}>
                                        {getConfidenceLabel(dup.confidenceLevel)}
                                      </Badge>
                                    </div>
                                    <div className="flex gap-1 mt-2 flex-wrap">
                                      {dup.matches.map((match, mIdx) => (
                                        <Badge key={mIdx} className={`text-xs ${
                                          match.includes('✓') ? 'bg-green-100 text-green-800 border-green-300' :
                                          'bg-orange-100 text-orange-800 border-orange-300'
                                        }`}>
                                          {match}
                                        </Badge>
                                      ))}
                                    </div>
                                    <div className="flex gap-2 mt-2 flex-wrap">
                                      <Badge className={`text-xs font-bold ${
                                        dup.score >= 80 ? 'bg-red-500 text-white' :
                                        dup.score >= 60 ? 'bg-orange-500 text-white' :
                                        dup.score >= 40 ? 'bg-yellow-500 text-white' :
                                        'bg-blue-500 text-white'
                                      }`}>
                                        Match Score: {Math.round(dup.score)}%
                                      </Badge>
                                      <Badge className="bg-navy-100 text-navy-800 border-navy-300 text-xs">
                                        {dup.criteriaMet} of 6 criteria met
                                      </Badge>
                                      {dup.differences.length > 0 && (
                                        <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
                                          {dup.differences.length} field{dup.differences.length > 1 ? 's' : ''} to update
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Show differences */}
                                {dup.differences.length > 0 ? (
                                  <div className="mt-3 p-3 bg-white rounded-lg border border-blue-200">
                                    <div className="flex items-center gap-2 mb-2">
                                      <AlertTriangle className="w-4 h-4 text-blue-600" />
                                      <p className="text-sm font-semibold text-blue-900">
                                        Fields that would be updated:
                                      </p>
                                    </div>
                                    <div className="space-y-2 max-h-48 overflow-y-auto">
                                      {dup.differences.map((diff, diffIdx) => (
                                        <div key={diffIdx} className="text-xs p-2 bg-blue-50 rounded border border-blue-200">
                                          <div className="font-semibold text-slate-800 mb-1 capitalize">
                                            {diff.field.replace(/_/g, ' ')}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className={`flex-1 ${diff.isNew ? 'text-slate-500 italic' : 'text-red-700'}`}>
                                              Current: {diff.existingValue}
                                            </span>
                                            <ArrowRight className="w-3 h-3 text-blue-600 flex-shrink-0" />
                                            <span className="flex-1 text-green-700 font-medium">
                                              New: {diff.importedValue}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <Alert className="mt-3 bg-green-50 border-green-200">
                                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                                    <AlertDescription className="text-xs text-green-900">
                                      All data matches existing record - no updates needed
                                    </AlertDescription>
                                  </Alert>
                                )}

                                <div className="grid grid-cols-3 gap-2 mt-3">
                                 <Button
                                  size="sm"
                                  variant={resolution[index]?.action === 'update' && resolution[index]?.existingPatientId === dup.patient.id ? 'default' : 'outline'}
                                  onClick={() => handleSetResolution(index, 'update', dup.patient.id)}
                                  className={`text-xs ${resolution[index]?.action === 'update' && resolution[index]?.existingPatientId === dup.patient.id ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
                                  disabled={dup.differences.length === 0}
                                 >
                                  <RefreshCw className="w-3 h-3 mr-1" />
                                  {dup.confidenceLevel === 'definitive' ? '✓ Update' : 'Update'}{dup.differences.length > 0 && ` (${dup.differences.length})`}
                                 </Button>
                                  <Button
                                    size="sm"
                                    variant={resolution[index]?.action === 'close' && resolution[index]?.existingPatientId === dup.patient.id ? 'default' : 'outline'}
                                    onClick={() => handleSetResolution(index, 'close', dup.patient.id)}
                                    className="text-xs"
                                  >
                                    <UserX className="w-3 h-3 mr-1" />
                                    Close
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant={resolution[index]?.action === 'skip' ? 'default' : 'outline'}
                                    onClick={() => handleSetResolution(index, 'skip')}
                                    className="text-xs"
                                  >
                                    Skip Row
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          ))}

                          <div className="pt-2 border-t">
                            <Button
                              size="sm"
                              variant={resolution[index]?.action === 'add' ? 'default' : 'outline'}
                              onClick={() => handleSetResolution(index, 'add')}
                              className="w-full bg-green-600 hover:bg-green-700 text-white"
                            >
                              <UserPlus className="w-4 h-4 mr-2" />
                              Add as New Patient (Ignore Duplicates)
                            </Button>
                          </div>

                          {resolution[index] && (
                            <Alert className={resolution[index].auto ? 'bg-navy-50 border-navy-300' : 'bg-blue-50 border-blue-200'}>
                              <CheckCircle2 className={`w-4 h-4 ${resolution[index].auto ? 'text-navy-600' : 'text-blue-600'}`} />
                              <AlertDescription className={`text-sm ${resolution[index].auto ? 'text-navy-900' : 'text-blue-900'}`}>
                                <strong>{resolution[index].auto ? 'Auto-selected (MRN Match):' : 'Action selected:'}</strong>{' '}
                                {resolution[index].action === 'add' && 'Add as new patient'}
                                {resolution[index].action === 'update' && 'Update existing patient with new information'}
                                {resolution[index].action === 'close' && 'Close existing patient'}
                                {resolution[index].action === 'skip' && (resolution[index].auto ? 'MRN match found but no updates needed - skipping' : 'Skip this row')}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </>
          )}

          <div className="mt-6 pt-4 border-t">
            <Button
              onClick={handleApplyResolutions}
              disabled={!allResolved || isProcessing}
              className="w-full bg-blue-600 hover:bg-blue-700"
              size="lg"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4 mr-2" />
                  Apply Resolutions & Continue Import
                </>
              )}
            </Button>
            {!allResolved && (
              <p className="text-sm text-orange-600 text-center mt-2">
                Please resolve all duplicates before continuing
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}