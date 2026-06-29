import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, User, XCircle, Phone, MapPin, Calendar, FileText } from "lucide-react";

export default function PatientMatchReview({ referral, onConfirmMatch, onCreateNew, onClose }) {
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'comparison'
  const matchAnalysis = referral.match_analysis;
  
  // Fetch full patient details for suggested matches
  const { data: suggestedPatients = [] } = useQuery({
    queryKey: ['suggestedPatients', referral.match_suggestions],
    queryFn: async () => {
      if (!referral.match_suggestions?.length) return [];
      const patientIds = referral.match_suggestions.map(m => m.patient_id);
      const allPatients = await base44.entities.Patient.list('-created_date', 500);
      return allPatients.filter(p => patientIds.includes(p.id));
    },
    enabled: !!referral.match_suggestions?.length,
    initialData: []
  });

  if (!matchAnalysis && !referral.match_suggestions) return null;

  const getConfidenceColor = (level) => {
    switch (level) {
      case 'high': return 'bg-green-100 text-green-800 border-green-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-orange-100 text-orange-800 border-orange-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const referralData = referral.extracted_data?.demographics || {};
  
  const selectedPatient = suggestedPatients.find(p => p.id === selectedMatch);

  return (
    <div className="space-y-4">
      <Alert className="bg-yellow-50 border-yellow-300">
        <AlertCircle className="w-4 h-4 text-yellow-600" />
        <AlertDescription className="text-yellow-900">
          <strong>Patient Match Requires Review</strong>
          <p className="mt-1 text-sm">
            The AI system found {referral.match_suggestions?.length || 0} potential matches. 
            Review the side-by-side comparison and select the best option.
          </p>
        </AlertDescription>
      </Alert>
      
      {/* View Mode Toggle */}
      <div className="flex gap-2 justify-center">
        <Button
          size="sm"
          variant={viewMode === 'list' ? 'default' : 'outline'}
          onClick={() => setViewMode('list')}
        >
          List View
        </Button>
        <Button
          size="sm"
          variant={viewMode === 'comparison' ? 'default' : 'outline'}
          onClick={() => setViewMode('comparison')}
          disabled={!selectedMatch}
        >
          Side-by-Side Comparison
        </Button>
      </div>

      {matchAnalysis && (
      <Card className="border-2 border-blue-300">
        <CardHeader className="bg-blue-50">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-blue-600" />
            AI Match Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-xs font-medium text-slate-600">Confidence Level</span>
                <div className="mt-1">
                  <Badge className={getConfidenceColor(matchAnalysis.confidence_level) + " text-sm"}>
                    {(matchAnalysis.confidence_level || 'unknown').toUpperCase()}
                  </Badge>
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-slate-600">Confidence Score</span>
                <div className="mt-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${
                          matchAnalysis.confidence_score >= 80 ? "bg-green-500" :
                          matchAnalysis.confidence_score >= 60 ? "bg-yellow-500" :
                          "bg-orange-500"
                        }`}
                        style={{ width: `${matchAnalysis.confidence_score}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold">{Math.round(matchAnalysis.confidence_score)}%</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="pt-3 border-t">
              <span className="text-sm font-medium text-slate-900">AI Reasoning:</span>
              <p className="text-sm text-slate-700 mt-1 bg-slate-50 p-3 rounded">{matchAnalysis.reasoning}</p>
            </div>

            {matchAnalysis.match_factors && matchAnalysis.match_factors.length > 0 && (
              <div>
                <span className="text-sm font-medium text-green-700">Supporting Evidence:</span>
                <ul className="list-disc list-inside mt-1 text-sm text-slate-700 space-y-1">
                  {matchAnalysis.match_factors.map((factor, i) => (
                    <li key={i} className="text-green-600">{factor}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {viewMode === 'list' && referral.match_suggestions && referral.match_suggestions.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900">Potential Matches ({referral.match_suggestions.length})</h3>
          
          {referral.match_suggestions.map((match, index) => {
            const patient = suggestedPatients.find(p => p.id === match.patient_id);
            return (
              <Card
                key={match.patient_id}
                className={`cursor-pointer transition-all ${
                  selectedMatch === match.patient_id
                    ? 'border-2 border-blue-500 bg-blue-50'
                    : 'hover:border-blue-300'
                }`}
                onClick={() => setSelectedMatch(match.patient_id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="w-4 h-4 text-slate-500" />
                        <span className="font-medium">
                          {patient ? `${patient.first_name} ${patient.last_name}` : `Match Option ${index + 1}`}
                        </span>
                        <Badge 
                          variant="outline"
                          className={
                            match.confidence_score >= 80 ? "bg-green-100 text-green-700 border-green-300" :
                            match.confidence_score >= 60 ? "bg-yellow-100 text-yellow-700 border-yellow-300" :
                            "bg-orange-100 text-orange-700 border-orange-300"
                          }
                        >
                          {Math.round(match.confidence_score)}% match
                        </Badge>
                      </div>
                      
                      {patient && (
                        <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-2">
                          {patient.date_of_birth && (
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              DOB: {patient.date_of_birth}
                            </div>
                          )}
                          {patient.phone && (
                            <div className="flex items-center gap-1">
                              <Phone className="w-3 h-3" />
                              {patient.phone}
                            </div>
                          )}
                          {patient.address && (
                            <div className="flex items-center gap-1 col-span-2">
                              <MapPin className="w-3 h-3" />
                              {patient.address}
                            </div>
                          )}
                          {patient.medical_record_number && (
                            <div className="flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              MRN: {patient.medical_record_number}
                            </div>
                          )}
                        </div>
                      )}
                      
                      <div className="text-sm text-slate-700 space-y-2">
                        <div>
                          <strong className="text-green-700">✓ Matching Factors:</strong>
                          <ul className="list-disc list-inside mt-1 text-xs space-y-1 text-slate-600">
                            {match.reasons?.map((reason, i) => (
                              <li key={i} className="text-green-700">{reason}</li>
                            ))}
                          </ul>
                        </div>
                        
                        {match.discrepancies && match.discrepancies.length > 0 && (
                          <div className="mt-2 p-2 bg-orange-50 rounded border border-orange-200">
                            <strong className="text-orange-700 text-xs">⚠️ Discrepancies:</strong>
                            <ul className="list-disc list-inside mt-1 text-xs space-y-1 text-orange-600">
                              {match.discrepancies.map((disc, i) => (
                                <li key={i}>{disc}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {selectedMatch === match.patient_id && (
                      <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      
      {/* Side-by-Side Comparison View */}
      {viewMode === 'comparison' && selectedPatient && (
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900 text-center">Side-by-Side Comparison</h3>
          
          <div className="grid md:grid-cols-2 gap-4">
            {/* Referral Data */}
            <Card className="border-2 border-navy-300">
              <CardHeader className="bg-navy-50">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  New Referral Data
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Full Name</span>
                  <p className="text-sm font-medium">{referralData.full_name || 'N/A'}</p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Date of Birth</span>
                  <p className="text-sm">{referralData.date_of_birth || 'N/A'}</p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Phone</span>
                  <p className="text-sm">{referralData.phone || 'N/A'}</p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Address</span>
                  <p className="text-sm">{referralData.address || 'N/A'}</p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Medical Record #</span>
                  <p className="text-sm">{referralData.medical_record_number || referralData.mrn || 'N/A'}</p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Primary Diagnosis</span>
                  <p className="text-sm">{referral.extracted_data?.diagnoses?.primary_diagnosis || 'N/A'}</p>
                </div>
                {referralData.referring_physician && (
                  <div>
                    <span className="block text-xs font-semibold text-slate-500">Referring Physician</span>
                    <p className="text-sm">{referralData.referring_physician}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Existing Patient Data */}
            <Card className="border-2 border-blue-300">
              <CardHeader className="bg-blue-50">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Existing Patient Record
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Full Name</span>
                  <p className={`text-sm font-medium ${
                    referralData.full_name?.toLowerCase() === `${selectedPatient.first_name} ${selectedPatient.last_name}`.toLowerCase()
                      ? 'text-green-600' : 'text-orange-600'
                  }`}>
                    {selectedPatient.first_name} {selectedPatient.last_name}
                  </p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Date of Birth</span>
                  <p className={`text-sm ${
                    referralData.date_of_birth === selectedPatient.date_of_birth
                      ? 'text-green-600' : 'text-orange-600'
                  }`}>
                    {selectedPatient.date_of_birth || 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Phone</span>
                  <p className={`text-sm ${
                    referralData.phone === selectedPatient.phone
                      ? 'text-green-600' : selectedPatient.phone ? 'text-orange-600' : ''
                  }`}>
                    {selectedPatient.phone || 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Address</span>
                  <p className={`text-sm ${
                    referralData.address === selectedPatient.address
                      ? 'text-green-600' : selectedPatient.address ? 'text-orange-600' : ''
                  }`}>
                    {selectedPatient.address || 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Medical Record #</span>
                  <p className="text-sm">{selectedPatient.medical_record_number || 'N/A'}</p>
                </div>
                <div>
                  <span className="block text-xs font-semibold text-slate-500">Primary Diagnosis</span>
                  <p className="text-sm">{selectedPatient.primary_diagnosis || 'N/A'}</p>
                </div>
                {selectedPatient.physician_name && (
                  <div>
                    <span className="block text-xs font-semibold text-slate-500">Physician</span>
                    <p className="text-sm">{selectedPatient.physician_name}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          
          {/* Matching Score Card */}
          <Card className="border-2 border-green-300 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Overall Match Confidence</p>
                  <p className="text-xs text-slate-600">Based on {referral.match_factors?.length || 0} matching factors</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-green-700">{Math.round(referral.match_confidence || 0)}%</p>
                  <Badge className={
                    referral.match_confidence >= 90 ? "bg-green-600" :
                    referral.match_confidence >= 75 ? "bg-blue-600" : "bg-yellow-600"
                  }>
                    {referral.match_confidence >= 90 ? "High" :
                     referral.match_confidence >= 75 ? "Medium-High" : "Medium"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {matchAnalysis?.discrepancies && matchAnalysis.discrepancies.length > 0 && (
        <Alert className="bg-red-50 border-red-300">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <AlertDescription>
            <strong className="text-red-900">Discrepancies Found:</strong>
            <ul className="list-disc list-inside mt-2 text-sm text-red-800 space-y-1">
              {matchAnalysis.discrepancies.map((disc, i) => (
                <li key={i}>{disc}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-3 pt-4 border-t">
        <Button
          onClick={() => selectedMatch && onConfirmMatch(selectedMatch)}
          disabled={!selectedMatch}
          className="flex-1 bg-blue-600 hover:bg-blue-700"
        >
          <CheckCircle2 className="w-4 h-4 mr-2" />
          Confirm Selected Match
        </Button>
        <Button
          onClick={onCreateNew}
          variant="outline"
          className="flex-1"
        >
          <User className="w-4 h-4 mr-2" />
          Create New Patient
        </Button>
        <Button
          onClick={onClose}
          variant="ghost"
        >
          <XCircle className="w-4 h-4 mr-2" />
          Cancel
        </Button>
      </div>
    </div>
  );
}