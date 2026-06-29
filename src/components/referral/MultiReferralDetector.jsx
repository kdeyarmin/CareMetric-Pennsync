import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle2, Loader, FileStack } from 'lucide-react';

export default function MultiReferralDetector({ fileUrl, onDetectionComplete, onDismiss }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [selectedReferrals, setSelectedReferrals] = useState([]);

  const analyzeFile = React.useCallback(async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const response = await base44.functions.invoke('splitReferralPDF', {
        fileUrl
      });

      if (!response.data.success) {
        throw new Error('Failed to analyze PDF');
      }

      setAnalysis(response.data.analysis);
      
      // Pre-select all detected referrals
      if (response.data.analysis.referrals) {
        setSelectedReferrals(response.data.analysis.referrals.map(r => r.index));
      }
    } catch (err) {
      console.error('Analysis error:', err);
      setError(err.message || 'Failed to analyze PDF');
    } finally {
      setIsAnalyzing(false);
    }
  }, [fileUrl]);

  React.useEffect(() => {
    analyzeFile();
  }, [fileUrl, analyzeFile]);

  if (isAnalyzing) {
    return (
      <Alert className="bg-blue-50 border-blue-200">
        <Loader className="h-4 w-4 text-blue-600 animate-spin" />
        <AlertDescription className="text-blue-900 ml-3">
          Analyzing PDF to detect multiple referrals...
        </AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert className="bg-red-50 border-red-200">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-900 ml-3">
          {error}
          <Button
            size="sm"
            variant="outline"
            onClick={analyzeFile}
            className="ml-3 h-8"
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!analysis) {
    return null;
  }

  const { is_multiple_referrals, referral_count, referrals } = analysis;

  if (!is_multiple_referrals || referral_count <= 1) {
    // Single-referral PDF: still give the user a way forward. Without these actions
    // the upload dialog is stuck (the parent hides its create button while detection
    // is in progress and never gets an onDetectionComplete/onDismiss callback).
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4 space-y-3">
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-900 ml-3">
              Single referral detected. Ready to process.
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onDismiss} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={() => onDetectionComplete(analysis, (referrals || []).map((r) => r.index))}
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              Process Referral
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileStack className="h-5 w-5 text-blue-600" />
          Multiple Referrals Detected
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-white border-blue-300">
          <AlertDescription className="text-sm">
            This PDF contains <strong>{referral_count} separate referral documents</strong>. Select which ones to process below.
          </AlertDescription>
        </Alert>

        <div className="space-y-3 max-h-80 overflow-y-auto">
          {referrals?.map((referral) => (
            <Card key={referral.index} className={`cursor-pointer transition-all ${
              selectedReferrals.includes(referral.index)
                ? 'border-blue-400 bg-blue-50'
                : 'border-slate-200 bg-white hover:border-blue-300'
            }`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id={`ref-${referral.index}`}
                    checked={selectedReferrals.includes(referral.index)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedReferrals([...selectedReferrals, referral.index]);
                      } else {
                        setSelectedReferrals(selectedReferrals.filter(i => i !== referral.index));
                      }
                    }}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <Label htmlFor={`ref-${referral.index}`} className="font-semibold text-slate-900 cursor-pointer">
                      Referral #{referral.index}
                    </Label>
                    <div className="mt-2 space-y-1 text-sm text-slate-700">
                      {referral.patient_name && (
                        <div><span className="font-medium">Patient:</span> {referral.patient_name}</div>
                      )}
                      {referral.referral_source && (
                        <div><span className="font-medium">Source:</span> {referral.referral_source}</div>
                      )}
                      {referral.referral_date && (
                        <div><span className="font-medium">Date:</span> {referral.referral_date}</div>
                      )}
                      {referral.estimated_start_page && (
                        <div className="text-xs text-slate-600">
                          Pages {referral.estimated_start_page}-{referral.estimated_end_page}
                        </div>
                      )}
                    </div>
                    {referral.confidence < 90 && (
                      <Badge variant="outline" className="mt-2 bg-yellow-50 text-yellow-700 border-yellow-200">
                        {Math.round(referral.confidence)}% confidence
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-2 pt-4 border-t border-blue-200">
          <Button
            variant="outline"
            onClick={onDismiss}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onDetectionComplete(analysis, selectedReferrals)}
            disabled={selectedReferrals.length === 0}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            Process {selectedReferrals.length} Referral{selectedReferrals.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}