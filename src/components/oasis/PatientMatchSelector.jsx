import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, AlertTriangle, User, Calendar, XCircle, RotateCcw, ThumbsUp, MapPin, Phone, Award } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function PatientMatchSelector({ 
  extractedName, 
  extractedDOB,
  matchResults, 
  selectedPatientId, 
  onSelectPatient,
  allPatients,
  oasisUploadId
}) {
  const [showDispute, setShowDispute] = useState(false);
  const [disputeNotes, setDisputeNotes] = useState("");
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const queryClient = useQueryClient();

  const feedbackMutation = useMutation({
    mutationFn: (data) => base44.entities.OASISFeedback.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisFeedback'] });
      setFeedbackSubmitted(true);
    }
  });

  const handleConfirmMatch = async (patientId, isCorrect = true) => {
    onSelectPatient(patientId);
    
    // Log patient match activity
    const { logActivity, ActivityActions } = await import("@/components/utils/activityLogger");
    const selectedPatient = allPatients.find(p => p.id === patientId);
    
    logActivity(ActivityActions.PATIENT_MATCH, {
      extracted_name: extractedName,
      matched_patient_id: patientId,
      matched_patient_name: selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : 'Unknown',
      confidence: matchResults.matches?.find(m => m.patient.id === patientId)?.confidence,
      is_correct_match: isCorrect,
      page: 'OASISAnalyzer'
    });
    
    // Submit feedback
    if (matchResults && oasisUploadId) {
      feedbackMutation.mutate({
        oasis_upload_id: oasisUploadId,
        feedback_type: isCorrect ? 'correct_match' : 'manual_override',
        extracted_name: extractedName,
        extracted_dob: extractedDOB,
        suggested_patient_id: matchResults.matches?.[0]?.patient?.id,
        suggested_confidence: matchResults.matches?.[0]?.confidence,
        actual_patient_id: patientId,
        match_factors_used: matchResults.matches?.[0]?.matchFactors
      });
    }
  };

  const handleDispute = async () => {
    // Log dispute activity
    const { logActivity, ActivityActions } = await import("@/components/utils/activityLogger");
    
    logActivity(ActivityActions.DISPUTE_MATCH, {
      extracted_name: extractedName,
      suggested_patient_id: matchResults.matches?.[0]?.patient?.id,
      suggested_confidence: matchResults.matches?.[0]?.confidence,
      dispute_notes: disputeNotes,
      page: 'OASISAnalyzer'
    });
    
    if (matchResults && oasisUploadId) {
      feedbackMutation.mutate({
        oasis_upload_id: oasisUploadId,
        feedback_type: 'incorrect_match',
        extracted_name: extractedName,
        extracted_dob: extractedDOB,
        suggested_patient_id: matchResults.matches?.[0]?.patient?.id,
        suggested_confidence: matchResults.matches?.[0]?.confidence,
        actual_patient_id: selectedPatientId || null,
        user_notes: disputeNotes,
        match_factors_used: matchResults.matches?.[0]?.matchFactors
      });
    }
    setShowDispute(false);
    setDisputeNotes("");
  };

  if (!extractedName || !matchResults) return null;

  const getConfidenceColor = (score) => {
    if (score >= 90) return 'bg-green-100 text-green-800 border-green-300';
    if (score >= 70) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    if (score >= 50) return 'bg-orange-100 text-orange-800 border-orange-300';
    return 'bg-red-100 text-red-800 border-red-300';
  };

  const getConfidenceIcon = (score) => {
    if (score >= 90) return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    if (score >= 70) return <CheckCircle2 className="w-4 h-4 text-yellow-600" />;
    return <AlertTriangle className="w-4 h-4 text-orange-600" />;
  };

  const getConfidenceBadge = (score) => {
    if (score >= 85) return 'bg-green-100 text-green-800 border-green-300';
    if (score >= 70) return 'bg-blue-100 text-blue-800 border-blue-300';
    if (score >= 55) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-orange-100 text-orange-800 border-orange-300';
  };

  const bestMatch = matchResults.matches?.[0];
  const hasAlternatives = matchResults.matches?.length > 1;

  return (
    <Card className="border-2 border-blue-200">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <User className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-slate-900">Patient Matching</span>
        </div>

        {/* Extracted Info */}
        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
          <p className="text-xs text-blue-700 mb-2">Extracted from OASIS:</p>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-900 flex items-center gap-2">
              <User className="w-4 h-4" />
              {extractedName || <span className="text-red-600">Name not found</span>}
            </p>
            {extractedDOB && (
              <p className="text-xs text-slate-600 flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                DOB: {extractedDOB}
              </p>
            )}
          </div>
        </div>

        {/* Best Match */}
        {bestMatch ? (
          <div className={`p-3 rounded-lg border-2 ${getConfidenceColor(bestMatch.confidence)}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {getConfidenceIcon(bestMatch.confidence)}
                <span className="text-sm font-semibold text-slate-900">
                  {bestMatch.confidence >= 90 ? 'Strong Match' : bestMatch.confidence >= 70 ? 'Likely Match' : 'Possible Match'}
                </span>
              </div>
              <Badge className={getConfidenceColor(bestMatch.confidence)}>
                {bestMatch.confidence}% confidence
              </Badge>
            </div>
            
            <div className="bg-white p-2 rounded border mb-2">
              <p className="font-medium text-slate-900">
                {bestMatch.patient.first_name} {bestMatch.patient.last_name}
              </p>
              <div className="space-y-0.5 mt-1">
                {bestMatch.patient.date_of_birth && (
                  <p className="text-xs text-slate-600 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    DOB: {bestMatch.patient.date_of_birth}
                    {bestMatch.dobMatch && <CheckCircle2 className="w-3 h-3 text-green-600 ml-1" />}
                  </p>
                )}

                {bestMatch.patient.address && (
                  <p className="text-xs text-slate-600 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {bestMatch.patient.address}
                    {bestMatch.addressMatch && <CheckCircle2 className="w-3 h-3 text-green-600 ml-1" />}
                    </p>
                    )}
                    {bestMatch.patient.phone && (
                    <p className="text-xs text-slate-600 flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {bestMatch.patient.phone}
                    {bestMatch.phoneMatch && <CheckCircle2 className="w-3 h-3 text-green-600 ml-1" />}
                    </p>
                    )}
                    </div>
                    </div>

                    {/* Match Quality Indicators */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge className={
                    bestMatch.confidence >= 85 ? 'bg-green-600 text-white' :
                    bestMatch.confidence >= 70 ? 'bg-blue-600 text-white' :
                    bestMatch.confidence >= 55 ? 'bg-yellow-600 text-white' :
                    'bg-orange-600 text-white'
                    }>
                    {bestMatch.confidence}% Match
                    </Badge>
                    {bestMatch.verifiedIdentifiers >= 3 && (
                    <Badge className="bg-navy-600 text-white text-xs">
                    <Award className="w-3 h-3 mr-1" />
                    {bestMatch.verifiedIdentifiers} IDs Verified
                    </Badge>
                    )}
                    {bestMatch.matchQuality && (
                    <Badge variant="outline" className="text-xs capitalize">
                    {bestMatch.matchQuality.replace('_', ' ')}
                    </Badge>
                    )}
                    </div>

                    {/* Match Factors */}
            <div className="text-xs text-slate-700 space-y-1">
              {bestMatch.matchFactors?.map((factor, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <span className="text-green-600">✓</span>
                  {factor}
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-2">
              {bestMatch.confidence >= 70 && (
                <Button
                  onClick={() => handleConfirmMatch(bestMatch.patient.id, true)}
                  size="sm"
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  <ThumbsUp className="w-3 h-3 mr-2" />
                  Correct Match
                </Button>
              )}
              <Button
                onClick={() => setShowDispute(true)}
                size="sm"
                variant="outline"
                className={`${bestMatch.confidence >= 70 ? 'flex-1' : 'w-full'} border-red-300 text-red-700 hover:bg-red-50`}
              >
                <XCircle className="w-3 h-3 mr-2" />
                Dispute
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-red-50 p-3 rounded-lg border border-red-200 text-center">
            <AlertTriangle className="w-5 h-5 text-red-600 mx-auto mb-2" />
            <p className="text-sm text-red-800">No matching patient found</p>
          </div>
        )}

        {/* Alternative Matches - More Prominent */}
        {hasAlternatives && (
          <div className="bg-gradient-to-r from-navy-50 to-gold-50 p-4 rounded-lg border-2 border-navy-300">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-navy-900">Alternative Matches</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAllMatches(!showAllMatches)}
                className="text-navy-700"
              >
                {showAllMatches ? 'Show Less' : `Show All (${matchResults.matches.length - 1})`}
              </Button>
            </div>
            <div className="space-y-2">
              {matchResults.matches.slice(1, showAllMatches ? undefined : 4).map((match, idx) => (
                <div 
                  key={idx}
                  className={`bg-white p-3 rounded-lg border-2 cursor-pointer hover:border-navy-400 transition-all ${
                    selectedPatientId === match.patient.id ? 'border-navy-500 ring-2 ring-navy-200' : 'border-slate-200'
                  }`}
                  onClick={() => handleConfirmMatch(match.patient.id, false)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {match.patient.first_name} {match.patient.last_name}
                      </p>
                      <Badge className={getConfidenceBadge(match.confidence)}>
                        {match.confidence}%
                      </Badge>
                    </div>
                    {selectedPatientId === match.patient.id && (
                      <CheckCircle2 className="w-5 h-5 text-navy-600" />
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {match.patient.date_of_birth && (
                      <p className="text-xs text-slate-600 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        DOB: {match.patient.date_of_birth}
                        {match.dobMatch && <CheckCircle2 className="w-3 h-3 text-green-600" />}
                      </p>
                    )}

                    {match.patient.address && (
                      <p className="text-xs text-slate-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {match.patient.address}
                      </p>
                    )}
                  </div>
                  {match.matchFactors && match.matchFactors.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {match.matchFactors.slice(0, 3).map((factor, fIdx) => (
                        <Badge key={fIdx} variant="outline" className="text-xs">
                          {factor}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Manual Override */}
        <div className="border-t pt-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-600">Manual Selection:</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onSelectPatient("");
                setShowDispute(false);
              }}
              className="text-xs h-7"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          </div>
          <Select 
            value={selectedPatientId || "none"} 
            onValueChange={(v) => handleConfirmMatch(v === "none" ? "" : v, false)}
          >
            <SelectTrigger className="bg-white">
              <SelectValue placeholder="Choose different patient..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No patient (save standalone)</SelectItem>
              {allPatients.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.first_name} {p.last_name}
                  {p.date_of_birth && ` - DOB: ${p.date_of_birth}`}
                  {p.medical_record_number && ` - MRN: ${p.medical_record_number}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Feedback Status */}
        {feedbackSubmitted && (
          <Alert className="bg-green-50 border-green-200 mt-3">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800 text-xs">
              Thank you! Your feedback helps improve matching accuracy.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>

      {/* Dispute Dialog */}
      <Dialog open={showDispute} onOpenChange={setShowDispute}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report Incorrect Match</DialogTitle>
            <DialogDescription>
              Help us improve matching accuracy by explaining why this match is incorrect.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
              <p className="text-xs text-yellow-700 mb-1">Suggested Match:</p>
              <p className="font-medium text-slate-900">
                {bestMatch?.patient.first_name} {bestMatch?.patient.last_name}
              </p>
              <p className="text-xs text-slate-600">Confidence: {bestMatch?.confidence}%</p>
            </div>

            <div>
              <label htmlFor="dispute-notes" className="text-sm font-medium text-slate-700 mb-2 block">
                What's wrong with this match?
              </label>
              <Textarea
                id="dispute-notes"
                value={disputeNotes}
                onChange={(e) => setDisputeNotes(e.target.value)}
                placeholder="e.g., Different patient with similar name, wrong DOB, etc."
                className="h-20"
              />
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleDispute}
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                Submit Feedback
              </Button>
              <Button
                onClick={() => setShowDispute(false)}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}