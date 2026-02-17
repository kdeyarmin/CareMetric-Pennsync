import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  Download, 
  Copy,
  Settings,
  RefreshCw,
  ChevronDown
} from "lucide-react";
import { toast } from "sonner";

const FOCUS_AREAS = [
  { id: 'cardiac', label: 'Cardiac History', icon: '❤️' },
  { id: 'respiratory', label: 'Respiratory', icon: '🫁' },
  { id: 'diabetes', label: 'Diabetes', icon: '🔬' },
  { id: 'medications', label: 'Medications', icon: '💊' },
  { id: 'allergies', label: 'Allergies', icon: '⚠️' },
  { id: 'recent_labs', label: 'Recent Labs', icon: '📊' },
  { id: 'vitals', label: 'Vitals Trends', icon: '📈' },
  { id: 'social', label: 'Social History', icon: '👥' },
];

export default function AIPatientSummaryGenerator({ patientId, patientName, onSummaryGenerated }) {
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryLength, setSummaryLength] = useState('medium');
  const [selectedFocusAreas, setSelectedFocusAreas] = useState([]);
  const [showOptions, setShowOptions] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const toggleFocusArea = (areaId) => {
    setSelectedFocusAreas(prev => 
      prev.includes(areaId) 
        ? prev.filter(id => id !== areaId)
        : [...prev, areaId]
    );
  };

  const generateSummary = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('generatePatientSummary', {
        patient_id: patientId,
        summary_length: summaryLength,
        focus_areas: selectedFocusAreas,
        include_vitals: true,
        include_medications: true,
        include_allergies: true,
        include_recent_visits: true
      });

      setSummary(response);
      onSummaryGenerated?.(response);
      toast.success('Patient summary generated!');
    } catch (error) {
      console.error('Error generating summary:', error);
      toast.error('Failed to generate summary');
    } finally {
      setLoading(false);
    }
  };

  const downloadSummary = () => {
    if (!summary) return;

    const content = `
PATIENT SUMMARY
===============
Patient: ${summary.patient_name}
MRN: ${summary.mrn}
Generated: ${new Date(summary.generated_at).toLocaleString()}

${summary.summary}

KEY POINTS:
${summary.key_points.map(point => `• ${point}`).join('\n')}

${summary.concerns.length > 0 ? `
CONCERNS:
${summary.concerns.map(concern => `⚠️  ${concern}`).join('\n')}
` : ''}

${summary.recommendations.length > 0 ? `
RECOMMENDATIONS:
${summary.recommendations.map(rec => `→ ${rec}`).join('\n')}
` : ''}
    `.trim();

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${patientName}_summary_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Summary downloaded');
  };

  const copySummary = () => {
    if (!summary) return;
    
    const text = `${summary.patient_name} (MRN: ${summary.mrn})\n\n${summary.summary}`;
    navigator.clipboard.writeText(text);
    toast.success('Summary copied to clipboard');
  };

  if (!patientId || patientId === 'no_patient') {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 p-2 rounded transition-colors"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-600" />
            <CardTitle className="text-sm">Pre-Visit Patient Summary</CardTitle>
          </div>
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Options */}
          <div className="space-y-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
            {/* Summary Length */}
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Summary Length</label>
              <div className="flex gap-2 mt-2">
                {['short', 'medium', 'long'].map(length => (
                  <button
                    key={length}
                    onClick={() => setSummaryLength(length)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      summaryLength === length
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {length.charAt(0).toUpperCase() + length.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Focus Areas */}
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-2">
                Focus Areas (Optional)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {FOCUS_AREAS.map(area => (
                  <button
                    key={area.id}
                    onClick={() => toggleFocusArea(area.id)}
                    className={`p-2 rounded text-xs font-medium transition-all text-center ${
                      selectedFocusAreas.includes(area.id)
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:border-blue-400'
                    }`}
                  >
                    <span className="block text-sm mb-1">{area.icon}</span>
                    <span className="text-[10px]">{area.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <Button
            onClick={generateSummary}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            size="sm"
          >
            {loading ? (
              <>
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                Generating Summary...
              </>
            ) : (
              <>
                <Settings className="w-3 h-3 mr-2" />
                Generate Patient Summary
              </>
            )}
          </Button>

          {/* Summary Display */}
          {summary && (
            <div className="space-y-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                    {summary.patient_name}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    MRN: {summary.mrn}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs">
                  {summary.length}
                </Badge>
              </div>

              {/* Summary Text */}
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div className="text-xs sm:text-sm leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {summary.summary}
                </div>
              </div>

              {/* Key Points */}
              {summary.key_points.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    Key Points:
                  </p>
                  <ul className="text-xs space-y-1 text-slate-700 dark:text-slate-300">
                    {summary.key_points.map((point, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="text-blue-600 flex-shrink-0">•</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Concerns */}
              {summary.concerns.length > 0 && (
                <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                  <p className="text-xs font-semibold text-red-900 dark:text-red-200 mb-2">
                    ⚠️ Concerns:
                  </p>
                  <ul className="text-xs space-y-1 text-red-800 dark:text-red-300">
                    {summary.concerns.map((concern, idx) => (
                      <li key={idx}>• {concern}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              {summary.recommendations.length > 0 && (
                <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
                  <p className="text-xs font-semibold text-green-900 dark:text-green-200 mb-2">
                    ✓ Recommendations:
                  </p>
                  <ul className="text-xs space-y-1 text-green-800 dark:text-green-300">
                    {summary.recommendations.map((rec, idx) => (
                      <li key={idx}>→ {rec}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2 border-t border-blue-200 dark:border-blue-800">
                <Button
                  onClick={copySummary}
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs h-8"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
                <Button
                  onClick={downloadSummary}
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs h-8"
                >
                  <Download className="w-3 h-3 mr-1" />
                  Download
                </Button>
                <Button
                  onClick={() => setSummary(null)}
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs h-8"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  New
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}