import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertCircle,
  Loader,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';

/**
 * AI-powered referral triage analyzer
 * Parses unstructured clinical data and suggests urgency levels and care plans
 */
export default function ReferralTriageAnalyzer({ onTriageComplete }) {
  const [referralText, setReferralText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const urgencyColors = {
    CRITICAL: 'bg-red-100 text-red-800 border-red-300',
    HIGH: 'bg-orange-100 text-orange-800 border-orange-300',
    MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    LOW: 'bg-green-100 text-green-800 border-green-300',
  };

  const handleAnalyze = async () => {
    if (!referralText.trim()) {
      setError('Please enter or paste referral data');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);

    try {
      const response = await fetch('/functions/triageReferralWithAI', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referralData: referralText }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Analysis failed');
      }

      const result = await response.json();

      if (result.success && result.analysis) {
        setAnalysis(result.analysis);
        onTriageComplete?.(result.analysis);
        toast.success('Triage analysis complete');
      } else {
        setError('Failed to analyze referral');
      }
    } catch (err) {
      setError(err.message || 'Analysis error');
      console.error('Triage error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setReferralText(text);
      setError(null);
      toast.success('File loaded');
    } catch {
      setError('Failed to read file');
    }
  };

  const handleCopyAnalysis = () => {
    const text = JSON.stringify(analysis, null, 2);
    // Await the clipboard write so a rejected copy (permissions / insecure
    // context) shows an error instead of a false "copied" toast + unhandled rejection.
    navigator.clipboard.writeText(text)
      .then(() => toast.success('Analysis copied to clipboard'))
      .catch(() => toast.error('Failed to copy to clipboard'));
  };

  const handleDownloadAnalysis = () => {
    const dataStr = JSON.stringify(analysis, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', `triage-${analysis.patient_name}-${new Date().toISOString().split('T')[0]}.json`);
    link.click();
  };

  return (
    <div className="w-full space-y-6">
      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            Referral Input
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="referral-text" className="text-sm font-semibold text-slate-700 block mb-2">
              Paste referral documentation or fax text
            </label>
            <Textarea
              id="referral-text"
              value={referralText}
              onChange={(e) => setReferralText(e.target.value)}
              placeholder="Paste referral information here... Can include fax text, email content, or any unstructured clinical notes..."
              className="min-h-[200px] font-mono text-sm"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              Upload File
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.pdf,.rtf"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              onClick={handleAnalyze}
              disabled={!referralText.trim() || isAnalyzing}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700 flex-1"
            >
              {isAnalyzing ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Analyze Referral'
              )}
            </Button>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-900">Error</p>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analysis Results */}
      {analysis && (
        <div className="space-y-4">
          {/* Urgency Banner */}
          <div className={`p-4 rounded-lg border-2 ${urgencyColors[analysis.urgency_level]}`}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                {analysis.urgency_level === 'CRITICAL' && (
                  <AlertTriangle className="w-6 h-6" />
                )}
                {analysis.urgency_level === 'HIGH' && (
                  <AlertCircle className="w-6 h-6" />
                )}
                {['MEDIUM', 'LOW'].includes(analysis.urgency_level) && (
                  <CheckCircle2 className="w-6 h-6" />
                )}
                <div>
                  <p className="text-sm font-bold">Urgency Level: {analysis.urgency_level}</p>
                  <p className="text-xs mt-1">{analysis.urgency_reason}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Patient Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Patient Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold">Patient Name</p>
                  <p className="text-sm font-semibold text-slate-900">{analysis.patient_name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold">Date of Birth</p>
                  <p className="text-sm font-semibold text-slate-900">{analysis.date_of_birth}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-600 uppercase font-semibold">Primary Diagnosis</p>
                <p className="text-sm text-slate-900">{analysis.primary_diagnosis}</p>
              </div>
              {analysis.secondary_diagnoses?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold mb-2">Secondary Diagnoses</p>
                  <div className="flex flex-wrap gap-1">
                    {analysis.secondary_diagnoses.map((dx, i) => (
                      <Badge key={i} variant="outline">
                        {dx}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Clinical Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Clinical Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-700 leading-relaxed">
                {analysis.clinical_summary}
              </p>
            </CardContent>
          </Card>

          {/* Risk Factors */}
          {analysis.key_risk_factors?.length > 0 && (
            <Card className="border-yellow-200 bg-yellow-50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  Risk Factors
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analysis.key_risk_factors.map((risk, i) => (
                    <li key={i} className="text-sm text-slate-700 flex gap-2">
                      <span className="text-yellow-600 font-bold">•</span>
                      {risk}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Preliminary Care Plan */}
          <Card className="border-indigo-200 bg-indigo-50">
            <CardHeader>
              <CardTitle className="text-lg">Preliminary Care Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold">Nursing Frequency</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {analysis.preliminary_care_plan?.skilled_nursing_frequency}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold">Medications to Reconcile</p>
                  <p className="text-sm text-slate-900">
                    {analysis.preliminary_care_plan?.medications_to_reconcile}
                  </p>
                </div>
              </div>

              {analysis.preliminary_care_plan?.initial_focus_areas?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold mb-2">Initial Focus Areas</p>
                  <ul className="space-y-1">
                    {analysis.preliminary_care_plan.initial_focus_areas.map((area, i) => (
                      <li key={i} className="text-sm text-slate-700 flex gap-2">
                        <span className="text-indigo-600">✓</span>
                        {area}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.preliminary_care_plan?.equipment_needed?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold mb-2">Equipment Needed</p>
                  <div className="flex flex-wrap gap-1">
                    {analysis.preliminary_care_plan.equipment_needed.map((equip, i) => (
                      <Badge key={i} variant="secondary">
                        {equip}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {analysis.preliminary_care_plan?.safety_concerns?.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase font-semibold mb-2">Safety Concerns</p>
                  <div className="bg-red-50 p-2 rounded border border-red-200">
                    {analysis.preliminary_care_plan.safety_concerns.map((concern, i) => (
                      <p key={i} className="text-sm text-red-800 mb-1">
                        ⚠️ {concern}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Data Gaps */}
          {analysis.data_gaps?.length > 0 && (
            <Card className="border-slate-300">
              <CardHeader>
                <CardTitle className="text-lg">Data Gaps - Info Needed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-600 mb-2">Request the following from referral source:</p>
                <ul className="space-y-1">
                  {analysis.data_gaps.map((gap, i) => (
                    <li key={i} className="text-sm text-slate-700">
                      • {gap}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Admission Notes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Admission Nurse Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-50 p-3 rounded border border-slate-200">
                <p className="text-sm text-slate-700">{analysis.admission_notes}</p>
              </div>
            </CardContent>
          </Card>

          {/* Export Actions */}
          <div className="flex gap-2">
            <Button
              onClick={handleCopyAnalysis}
              variant="outline"
              className="gap-2 flex-1"
            >
              <Copy className="w-4 h-4" />
              Copy Analysis
            </Button>
            <Button
              onClick={handleDownloadAnalysis}
              variant="outline"
              className="gap-2 flex-1"
            >
              <Download className="w-4 h-4" />
              Download JSON
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}