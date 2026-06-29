import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  CheckCircle2,
  Activity,
  Heart,
  ChevronDown,
  ChevronUp,
  Zap,
  ClipboardList
} from "lucide-react";

export default function SmartNoteDataImport({ 
  patientId,
  _patientName,
  onImportData
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [importedData, setImportedData] = useState(null);

  // Fetch patient's recent visits with notes
  const { data: recentVisits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: async () => {
      if (!patientId) return [];
      const visits = await base44.entities.Visit.filter(
        { patient_id: patientId, status: 'completed' }, 
        '-visit_date', 
        10
      );
      return visits.filter(v => v.nurse_notes || v.vital_signs);
    },
    enabled: !!patientId
  });

  const handleImportFromVisit = () => {
    if (!selectedVisit) return;

    const importData = {
      vitalSigns: selectedVisit.vital_signs || {},
      narrative: selectedVisit.nurse_notes || '',
      visitType: selectedVisit.visit_type,
      visitDate: selectedVisit.visit_date,
      // Extract functional observations from narrative if present
      functionalObservations: extractFunctionalData(selectedVisit.nurse_notes || '')
    };

    setImportedData(importData);
    onImportData?.(importData);
  };

  // Extract functional status observations from narrative text
  const extractFunctionalData = (narrative) => {
    const observations = {};
    const lowerNarrative = narrative.toLowerCase();

    // Ambulation patterns
    if (lowerNarrative.includes('ambulates independently') || lowerNarrative.includes('walks independently')) {
      observations.ambulation = { score: 0, description: 'Independent' };
    } else if (lowerNarrative.includes('uses walker') || lowerNarrative.includes('with device')) {
      observations.ambulation = { score: 1, description: 'With device' };
    } else if (lowerNarrative.includes('requires assistance') || lowerNarrative.includes('assist with ambulation')) {
      observations.ambulation = { score: 3, description: 'Requires assistance' };
    } else if (lowerNarrative.includes('bedbound') || lowerNarrative.includes('non-ambulatory')) {
      observations.ambulation = { score: 6, description: 'Bedbound' };
    }

    // Transfer patterns
    if (lowerNarrative.includes('transfers independently')) {
      observations.transfer = { score: 0, description: 'Independent' };
    } else if (lowerNarrative.includes('assist with transfer') || lowerNarrative.includes('transfer assistance')) {
      observations.transfer = { score: 2, description: 'Requires assistance' };
    }

    // Bathing patterns
    if (lowerNarrative.includes('bathes independently')) {
      observations.bathing = { score: 0, description: 'Independent' };
    } else if (lowerNarrative.includes('sponge bath') || lowerNarrative.includes('bed bath')) {
      observations.bathing = { score: 4, description: 'Bed bath only' };
    }

    // Cognitive observations
    if (lowerNarrative.includes('oriented x3') || lowerNarrative.includes('alert and oriented')) {
      observations.cognitive = { status: 'Intact', score: 0 };
    } else if (lowerNarrative.includes('confused') || lowerNarrative.includes('disoriented')) {
      observations.cognitive = { status: 'Impaired', score: 2 };
    }

    return observations;
  };

  if (!patientId || recentVisits.length === 0) {
    return null;
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader 
        className="pb-2 bg-gradient-to-r from-navy-50 to-navy-50 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-navy-600" />
            Import from Smart Notes
            <Badge variant="outline" className="text-xs">{recentVisits.length} visits</Badge>
          </div>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </CardTitle>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="space-y-3 pt-3">
          <p className="text-xs text-slate-600">
            Import vital signs and functional observations from recent visit notes to pre-populate OASIS fields.
          </p>

          {/* Visit Selection */}
          <Select 
            value={selectedVisit?.id || ''} 
            onValueChange={(id) => setSelectedVisit(recentVisits.find(v => v.id === id))}
          >
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Select visit..." />
            </SelectTrigger>
            <SelectContent>
              {recentVisits.map((visit) => (
                <SelectItem key={visit.id} value={visit.id}>
                  <div className="flex items-center gap-2">
                    <ClipboardList className="w-3 h-3" />
                    <span>{visit.visit_type} - {visit.visit_date}</span>
                    {visit.vital_signs && (
                      <Badge variant="outline" className="text-xs ml-1">Has vitals</Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedVisit && (
            <>
              {/* Preview Data */}
              <div className="bg-slate-50 p-3 rounded-lg border space-y-2">
                {/* Vital Signs */}
                {selectedVisit.vital_signs && Object.keys(selectedVisit.vital_signs).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
                      <Heart className="w-3 h-3 text-red-500" /> Vital Signs:
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {selectedVisit.vital_signs.blood_pressure_systolic && (
                        <div className="bg-white p-1 rounded">
                          BP: {selectedVisit.vital_signs.blood_pressure_systolic}/{selectedVisit.vital_signs.blood_pressure_diastolic}
                        </div>
                      )}
                      {selectedVisit.vital_signs.heart_rate && (
                        <div className="bg-white p-1 rounded">
                          HR: {selectedVisit.vital_signs.heart_rate}
                        </div>
                      )}
                      {selectedVisit.vital_signs.oxygen_saturation && (
                        <div className="bg-white p-1 rounded">
                          O2: {selectedVisit.vital_signs.oxygen_saturation}%
                        </div>
                      )}
                      {selectedVisit.vital_signs.temperature && (
                        <div className="bg-white p-1 rounded">
                          Temp: {selectedVisit.vital_signs.temperature}°F
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Extracted Functional Observations */}
                {selectedVisit.nurse_notes && (
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1 flex items-center gap-1">
                      <Activity className="w-3 h-3 text-navy-500" /> Extracted Observations:
                    </p>
                    {(() => {
                      const obs = extractFunctionalData(selectedVisit.nurse_notes);
                      return Object.keys(obs).length > 0 ? (
                        <div className="grid grid-cols-2 gap-1 text-xs">
                          {obs.ambulation && (
                            <div className="bg-white p-1 rounded">
                              Ambulation: {obs.ambulation.description}
                            </div>
                          )}
                          {obs.transfer && (
                            <div className="bg-white p-1 rounded">
                              Transfer: {obs.transfer.description}
                            </div>
                          )}
                          {obs.bathing && (
                            <div className="bg-white p-1 rounded">
                              Bathing: {obs.bathing.description}
                            </div>
                          )}
                          {obs.cognitive && (
                            <div className="bg-white p-1 rounded">
                              Cognitive: {obs.cognitive.status}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">No specific functional observations extracted</p>
                      );
                    })()}
                  </div>
                )}

                {/* Note Preview */}
                {selectedVisit.nurse_notes && (
                  <div>
                    <p className="text-xs font-medium text-slate-700 mb-1">Note Preview:</p>
                    <p className="text-xs text-slate-600 bg-white p-2 rounded max-h-20 overflow-y-auto">
                      {selectedVisit.nurse_notes.substring(0, 300)}
                      {selectedVisit.nurse_notes.length > 300 && '...'}
                    </p>
                  </div>
                )}
              </div>

              {/* Import Button */}
              <Button
                onClick={handleImportFromVisit}
                className="w-full bg-navy-600 hover:bg-navy-700"
                size="sm"
              >
                <Zap className="w-4 h-4 mr-2" />
                Import Visit Data
              </Button>

              {importedData && (
                <Alert className="bg-green-50 border-green-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-800 text-xs">
                    Visit data imported! Vitals and observations applied.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}