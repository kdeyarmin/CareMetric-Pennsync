import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  UserCheck,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Users,
  Calendar,
  MapPin,
  Phone
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

export default function PatientVerificationStep({ 
  referral, 
  onConfirmMatch, 
  onCreateNew, 
  onSkip 
}) {
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const { data: allPatients = [] } = useQuery({
    queryKey: ['all-patients'],
    queryFn: () => base44.entities.Patient.list('-created_date', 500),
    initialData: [],
  });

  const extractedData = referral.extracted_data;
  const matchAnalysis = referral.match_analysis;
  const suggestions = referral.match_suggestions || [];

  // Get suggested patients
  const suggestedPatients = suggestions.map(sug => {
    const patient = allPatients.find(p => p.id === sug.patient_id);
    return patient ? { ...patient, confidence: sug.confidence_score, reasons: sug.reasons } : null;
  }).filter(Boolean);

  // Add best match from analysis if available
  if (matchAnalysis?.best_match_id && !suggestedPatients.find(p => p.id === matchAnalysis.best_match_id)) {
    const bestMatch = allPatients.find(p => p.id === matchAnalysis.best_match_id);
    if (bestMatch) {
      suggestedPatients.unshift({
        ...bestMatch,
        confidence: matchAnalysis.confidence_score,
        reasons: matchAnalysis.match_factors
      });
    }
  }

  const handleConfirm = async () => {
    if (!selectedPatientId) return;
    setIsConfirming(true);
    try {
      await onConfirmMatch(selectedPatientId);
    } catch (error) {
      console.error('Confirmation error:', error);
    }
    setIsConfirming(false);
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 90) return "bg-green-600";
    if (confidence >= 75) return "bg-blue-600";
    if (confidence >= 60) return "bg-yellow-600";
    return "bg-slate-600";
  };

  const getConfidenceBadgeText = (confidence) => {
    if (confidence >= 90) return "High Confidence";
    if (confidence >= 75) return "Medium-High";
    if (confidence >= 60) return "Medium";
    return "Low";
  };

  return (
    <div className="space-y-6">
      {/* Header Alert */}
      <Alert className="bg-yellow-50 border-yellow-300">
        <AlertTriangle className="w-5 h-5 text-yellow-600" />
        <AlertDescription className="text-yellow-900">
          <strong>Patient Verification Required</strong>
          <p className="text-sm mt-1">
            AI has analyzed the referral and found {suggestedPatients.length} potential match{suggestedPatients.length !== 1 ? 'es' : ''} in the system. 
            Please review and confirm the correct patient or create a new record.
          </p>
        </AlertDescription>
      </Alert>

      {/* Extracted Patient Info */}
      <Card className="border-2 border-blue-300">
        <CardHeader className="bg-blue-50">
          <CardTitle className="text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Referral Patient Information
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500">Full Name</p>
              <p className="font-semibold text-lg">{extractedData?.demographics?.full_name || 'Not extracted'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Date of Birth</p>
              <p className="font-semibold flex items-center gap-1">
                <Calendar className="w-4 h-4 text-slate-400" />
                {extractedData?.demographics?.date_of_birth || 'Not extracted'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Phone</p>
              <p className="font-semibold flex items-center gap-1">
                <Phone className="w-4 h-4 text-slate-400" />
                {extractedData?.demographics?.phone || 'Not extracted'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Address</p>
              <p className="font-semibold flex items-center gap-1">
                <MapPin className="w-4 h-4 text-slate-400" />
                {extractedData?.demographics?.address || 'Not extracted'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Primary Diagnosis</p>
              <p className="font-semibold">{extractedData?.diagnoses?.primary_diagnosis || 'Not extracted'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Referring Physician</p>
              <p className="font-semibold">{extractedData?.demographics?.referring_physician || 'Not extracted'}</p>
            </div>
          </div>

          {/* Match Analysis Summary */}
          {matchAnalysis && (
            <div className="mt-4 p-3 bg-navy-50 rounded-lg border border-navy-200">
              <p className="text-sm font-semibold text-navy-900 mb-2">AI Match Analysis</p>
              <div className="flex items-center gap-2 mb-2">
                <Badge className={getConfidenceColor(matchAnalysis.confidence_score)}>
                  {Math.round(matchAnalysis.confidence_score)}% Confidence
                </Badge>
                <Badge variant="outline">{matchAnalysis.confidence_level} Match</Badge>
              </div>
              {matchAnalysis.match_factors?.length > 0 && (
                <div className="text-xs text-navy-800">
                  <strong>Match Factors:</strong> {matchAnalysis.match_factors.join(', ')}
                </div>
              )}
              {matchAnalysis.discrepancies?.length > 0 && (
                <div className="text-xs text-red-700 mt-1">
                  <strong>⚠️ Discrepancies:</strong> {matchAnalysis.discrepancies.join(', ')}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Potential Matches */}
      {suggestedPatients.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-green-600" />
            Potential Matches ({suggestedPatients.length})
          </h3>
          <div className="space-y-3">
            {suggestedPatients.map((patient) => (
              <Card
                key={patient.id}
                className={`cursor-pointer transition-all ${
                  selectedPatientId === patient.id
                    ? 'border-2 border-green-500 bg-green-50'
                    : 'border hover:border-slate-400 hover:shadow-md'
                }`}
                onClick={() => setSelectedPatientId(patient.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-bold text-lg">
                          {patient.first_name} {patient.middle_name} {patient.last_name}
                        </h4>
                        <Badge className={getConfidenceColor(patient.confidence)}>
                          {getConfidenceBadgeText(patient.confidence)} - {Math.round(patient.confidence)}%
                        </Badge>
                        {selectedPatientId === patient.id && (
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                        )}
                      </div>

                      {/* Patient Details */}
                      <div className="grid md:grid-cols-3 gap-3 text-sm">
                        <div className="flex items-center gap-1 text-slate-600">
                          <Calendar className="w-4 h-4" />
                          <span>DOB: {patient.date_of_birth ? format(new Date(patient.date_of_birth), 'MM/dd/yyyy') : 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <Phone className="w-4 h-4" />
                          <span>{patient.phone || 'No phone'}</span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-600">
                          <MapPin className="w-4 h-4" />
                          <span>{patient.address?.substring(0, 30) || 'No address'}</span>
                        </div>
                      </div>

                      {patient.primary_diagnosis && (
                        <div className="mt-2">
                          <Badge variant="outline" className="bg-blue-50 text-blue-700">
                            {patient.primary_diagnosis}
                          </Badge>
                        </div>
                      )}

                      {/* Match Reasons */}
                      {patient.reasons && patient.reasons.length > 0 && (
                        <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                          <p className="text-xs font-semibold text-blue-900 mb-1">Why this match?</p>
                          <div className="flex flex-wrap gap-1">
                            {patient.reasons.map((reason, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs bg-white">
                                {reason}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Discrepancies */}
                      {matchAnalysis?.discrepancies?.length > 0 && selectedPatientId === patient.id && (
                        <div className="mt-3 p-2 bg-red-50 rounded-lg border border-red-200">
                          <p className="text-xs font-semibold text-red-900 mb-1 flex items-center gap-1">
                            <XCircle className="w-3 h-3" />
                            Discrepancies Found
                          </p>
                          <ul className="text-xs text-red-800 list-disc list-inside">
                            {matchAnalysis.discrepancies.map((disc, idx) => (
                              <li key={idx}>{disc}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={handleConfirm}
          disabled={!selectedPatientId || isConfirming}
          className="flex-1 bg-green-600 hover:bg-green-700 h-12"
          size="lg"
        >
          {isConfirming ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              Confirming...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5 mr-2" />
              Confirm Selected Patient
            </>
          )}
        </Button>

        <Button
          onClick={onCreateNew}
          variant="outline"
          className="flex-1 border-blue-500 text-blue-700 hover:bg-blue-50 h-12"
          size="lg"
        >
          <UserPlus className="w-5 h-5 mr-2" />
          Create New Patient Record
        </Button>

        {onSkip && (
          <Button
            onClick={onSkip}
            variant="ghost"
            className="text-slate-600 hover:bg-slate-100"
          >
            Skip for Now
          </Button>
        )}
      </div>

      {/* Help Text */}
      <div className="bg-slate-50 p-4 rounded-lg border">
        <p className="text-sm text-slate-700">
          <strong>💡 Tip:</strong> Review the match confidence scores and discrepancies carefully. 
          High confidence matches (90%+) are typically accurate, but always verify critical information like DOB and name spelling.
        </p>
      </div>
    </div>
  );
}