import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Stethoscope,
  AlertTriangle,
  CheckCircle2,
  Pill,
  Beaker,
  ChevronDown,
  Copy
} from "lucide-react";
import { toast } from "sonner";

export default function ClinicalDecisionSupportPanel({
  symptoms,
  findings,
  diagnosis,
  patientAge,
  patientConditions,
  currentMedications,
  patientId
}) {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('tests');
  const [results, setResults] = useState({
    tests: null,
    protocol: null,
    interactions: null
  });
  const [expanded, setExpanded] = useState(false);

  const runSupport = async (action) => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('clinicalDecisionSupport', {
        action,
        symptoms,
        findings,
        diagnosis,
        patient_age: patientAge,
        patient_conditions: patientConditions,
        current_medications: currentMedications,
        patient_id: patientId
      });

      setResults(prev => ({
        ...prev,
        [action === 'suggest_tests' ? 'tests' : 
         action === 'treatment_protocol' ? 'protocol' : 'interactions']: response
      }));

      toast.success(`${action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} completed`);
    } catch (error) {
      console.error('Clinical support error:', error);
      toast.error('Failed to generate recommendations');
    } finally {
      setLoading(false);
    }
  };

  if (!diagnosis) return null;

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
      case 'urgent':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100';
      case 'high':
      case 'major':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100';
      case 'moderate':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100';
      case 'low':
      case 'minor':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100';
      case 'standard':
        return 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100';
    }
  };

  return (
    <Card className="w-full border-blue-300 dark:border-blue-600">
      <CardHeader className="pb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 p-2 rounded transition-colors"
        >
          <div className="flex items-center gap-2">
            <Stethoscope className="w-4 h-4 text-blue-600" />
            <CardTitle className="text-sm">Clinical Decision Support</CardTitle>
          </div>
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4">
              <TabsTrigger value="tests" className="text-xs">Tests</TabsTrigger>
              <TabsTrigger value="protocol" className="text-xs">Treatment</TabsTrigger>
              <TabsTrigger value="interactions" className="text-xs">Interactions</TabsTrigger>
            </TabsList>

            {/* Diagnostic Tests Tab */}
            <TabsContent value="tests" className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                AI-suggested diagnostic tests based on clinical presentation.
              </p>
              <Button
                onClick={() => runSupport('suggest_tests')}
                disabled={loading || !symptoms || !findings}
                className="w-full bg-blue-600 hover:bg-blue-700"
                size="sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Beaker className="w-3 h-3 mr-2" />
                    Suggest Tests
                  </>
                )}
              </Button>

              {results.tests?.tests && (
                <div className="space-y-2">
                  {results.tests.tests.map((test, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <p className="font-semibold text-xs text-slate-900 dark:text-slate-100">
                            {test.name}
                          </p>
                          <div className="flex gap-2 mt-1">
                            <Badge className={`text-xs ${getSeverityColor(test.priority)}`}>
                              {test.priority}
                            </Badge>
                            <Badge variant="outline" className="text-xs">{test.type}</Badge>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300 mb-2">
                        <span className="font-semibold">Rationale:</span> {test.rationale}
                      </p>
                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <p><span className="font-semibold">Turnaround:</span> {test.turnaround_time}</p>
                        <p><span className="font-semibold">Cost:</span> {test.cost}</p>
                      </div>
                      {test.preparation && (
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                          <span className="font-semibold">Prep:</span> {test.preparation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Treatment Protocol Tab */}
            <TabsContent value="protocol" className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Evidence-based treatment protocols tailored to patient conditions.
              </p>
              <Button
                onClick={() => runSupport('treatment_protocol')}
                disabled={loading}
                className="w-full bg-green-600 hover:bg-green-700"
                size="sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Pill className="w-3 h-3 mr-2" />
                    Generate Protocol
                  </>
                )}
              </Button>

              {results.protocol?.protocol && (
                <div className="space-y-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  {results.protocol.protocol.first_line && (
                    <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-700">
                      <p className="text-xs font-semibold text-green-900 dark:text-green-100 mb-2">First-Line Treatment</p>
                      <div className="text-xs text-green-800 dark:text-green-300 space-y-1">
                        <p><span className="font-semibold">Drug:</span> {results.protocol.protocol.first_line.medication}</p>
                        <p><span className="font-semibold">Dosing:</span> {results.protocol.protocol.first_line.dosing}</p>
                        <p><span className="font-semibold">Frequency:</span> {results.protocol.protocol.first_line.frequency}</p>
                        <p><span className="font-semibold">Duration:</span> {results.protocol.protocol.first_line.duration}</p>
                      </div>
                    </div>
                  )}

                  {results.protocol.protocol.alternatives && results.protocol.protocol.alternatives.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">Alternatives</p>
                      <div className="space-y-1">
                        {results.protocol.protocol.alternatives.map((alt, idx) => (
                          <div key={idx} className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 p-2 rounded">
                            <p><span className="font-semibold">{alt.medication}</span> - {alt.rationale}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {results.protocol.protocol.monitoring && results.protocol.protocol.monitoring.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">Monitoring</p>
                      <div className="space-y-1">
                        {results.protocol.protocol.monitoring.slice(0, 3).map((mon, idx) => (
                          <p key={idx} className="text-xs text-slate-700 dark:text-slate-300">
                            • {mon.parameter} - {mon.frequency}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}

                  {results.protocol.protocol.red_flags && results.protocol.protocol.red_flags.length > 0 && (
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-700">
                      <p className="text-xs font-semibold text-red-900 dark:text-red-100 mb-2">🚨 Red Flags</p>
                      <ul className="text-xs text-red-800 dark:text-red-300 space-y-1">
                        {results.protocol.protocol.red_flags.slice(0, 3).map((flag, idx) => (
                          <li key={idx}>• {flag}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-xs text-slate-600 dark:text-slate-400 italic">
                    Evidence: {results.protocol.protocol.evidence_base}
                  </p>
                </div>
              )}
            </TabsContent>

            {/* Drug Interactions Tab */}
            <TabsContent value="interactions" className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Check for drug interactions and contraindications.
              </p>
              <Button
                onClick={() => runSupport('drug_interactions')}
                disabled={loading || !currentMedications || currentMedications.length === 0}
                className="w-full bg-amber-600 hover:bg-amber-700"
                size="sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3 h-3 mr-2" />
                    Check Interactions
                  </>
                )}
              </Button>

              {results.interactions && (
                <div className="space-y-3">
                  {results.interactions.summary && (
                    <div className="p-2 bg-slate-100 dark:bg-slate-800 rounded border border-slate-300 dark:border-slate-600">
                      <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold">
                        Summary: {results.interactions.summary}
                      </p>
                    </div>
                  )}

                  {results.interactions.interactions && results.interactions.interactions.length > 0 && (
                    <div className="space-y-2">
                      {results.interactions.interactions.map((interaction, idx) => (
                        <div
                          key={idx}
                          className={`p-2 rounded border text-xs ${getSeverityColor(interaction.severity)}`}
                        >
                          <p className="font-semibold mb-1">
                            {interaction.drugs.join(' + ')}
                          </p>
                          <p className="mb-1">{interaction.clinical_significance}</p>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-[10px] opacity-75">
                              Type: {interaction.type}
                            </span>
                            {interaction.recommendation && (
                              <span className="text-[10px] font-semibold">
                                Action: {interaction.recommendation}
                              </span>
                            )}
                          </div>
                          {interaction.alternative && (
                            <p className="text-[10px] mt-1">
                              <span className="font-semibold">Alternative:</span> {interaction.alternative}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {results.interactions.contraindications && results.interactions.contraindications.length > 0 && (
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-300 dark:border-red-700">
                      <p className="text-xs font-semibold text-red-900 dark:text-red-100 mb-2">
                        🚫 Contraindications with Diagnosis
                      </p>
                      <ul className="text-xs text-red-800 dark:text-red-300 space-y-1">
                        {results.interactions.contraindications.map((contra, idx) => (
                          <li key={idx}>• {contra}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}