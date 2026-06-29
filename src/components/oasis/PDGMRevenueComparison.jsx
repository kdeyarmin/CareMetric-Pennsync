import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DollarSign,
  TrendingUp,
  Calculator,
  Loader2,
  FileDown,
  ArrowRight,
  Info,
  ChevronDown,
  ChevronUp,
  Wrench,
  Activity,
  Stethoscope,
  ClipboardList,
  Sliders,
  Trophy,
  AlertTriangle,
  Building2,
  Clock,
  GitCompare
} from "lucide-react";
import { calculatePDGM } from "@/functions/calculatePDGM";
import { generatePDGMComparisonPDF } from "@/functions/generatePDGMComparisonPDF";
import { Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import PDGMWhatIfBuilder from "./PDGMWhatIfBuilder";
import TopOptimizationOpportunities from "./TopOptimizationOpportunities";
import { debounce } from "@/lib/debounce";

function DataValidationWarnings({ validation }) {
  if (!validation?.hasDiscrepancies) return null;

  return (
    <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-yellow-600" />
        <span className="font-semibold text-yellow-800">Data Validation Warnings</span>
        <Badge className="bg-yellow-200 text-yellow-800">{validation.discrepancies.length}</Badge>
      </div>
      
      <div className="space-y-2">
        {validation.discrepancies.map((d, idx) => (
          <div key={idx} className="bg-white rounded-lg p-3 border border-yellow-200">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">{d.message}</p>
                <div className="flex items-center gap-2 mt-1 text-xs">
                  <Badge variant="outline" className="text-xs">
                    Expected: {d.expected}
                  </Badge>
                  <ArrowRight className="w-3 h-3 text-slate-400" />
                  <Badge variant="outline" className="text-xs bg-red-50 text-red-700">
                    Actual: {d.actual}
                  </Badge>
                </div>
                {d.evidence && (
                  <p className="text-xs text-slate-500 mt-1">Evidence: {d.evidence}</p>
                )}
              </div>
              <Badge className={`text-xs ${d.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                {d.severity}
              </Badge>
            </div>
            {d.revenueImpact && (
              <p className="text-xs text-green-700 mt-2 bg-green-50 p-1.5 rounded">
                💰 {d.revenueImpact}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AlternativeScenarios({ scenarios, currentKey }) {
  if (!scenarios?.scenarios) return null;

  const scenarioList = Object.entries(scenarios.scenarios);
  const formatCurrency = (amt) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amt);

  return (
    <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
      <div className="flex items-center gap-2 mb-3">
        <GitCompare className="w-4 h-4 text-indigo-600" />
        <span className="font-semibold text-indigo-800 text-sm">Payment Scenarios Comparison</span>
      </div>
      
      <div className="grid grid-cols-2 gap-2">
        {scenarioList.map(([key, data]) => {
          const isCurrent = key === currentKey;
          const isHighest = key === scenarios.highestScenario;
          const isLowest = key === scenarios.lowestScenario;
          
          return (
            <div 
              key={key}
              className={`p-3 rounded-lg border-2 ${
                isCurrent ? 'bg-blue-100 border-blue-400' :
                isHighest ? 'bg-green-50 border-green-300' :
                isLowest ? 'bg-slate-50 border-slate-300' :
                'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  {data.admissionSource === 'institutional' ? (
                    <Building2 className="w-3 h-3 text-navy-500" />
                  ) : (
                    <Activity className="w-3 h-3 text-blue-500" />
                  )}
                  <span className="text-xs font-medium capitalize">{data.admissionSource}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span className="text-xs capitalize">{data.episodeTiming}</span>
                </div>
              </div>
              <p className={`text-lg font-bold ${
                isHighest ? 'text-green-700' : 
                isLowest ? 'text-slate-600' : 
                'text-slate-800'
              }`}>
                {formatCurrency(data.totalPayment)}
              </p>
              <div className="flex items-center gap-1 mt-1">
                {isCurrent && <Badge className="text-xs bg-blue-600">Current</Badge>}
                {isHighest && <Badge className="text-xs bg-green-600">Highest</Badge>}
                {isLowest && !isHighest && <Badge className="text-xs bg-slate-500">Lowest</Badge>}
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="mt-3 pt-3 border-t border-indigo-200 text-xs text-indigo-700">
        <p>Payment range: {formatCurrency(scenarios.minPayment)} - {formatCurrency(scenarios.maxPayment)} 
          <span className="font-semibold ml-1">(Δ {formatCurrency(scenarios.paymentRange)})</span>
        </p>
      </div>
    </div>
  );
}

function _CaseMixBreakdown({ original, corrected }) {
  if (!original) return null;

  const componentData = [
    { 
      name: 'Clinical', 
      original: original.clinicalWeight || 1, 
      corrected: corrected?.clinicalWeight || original.clinicalWeight || 1,
      fullName: 'Clinical Group'
    },
    { 
      name: 'Functional', 
      original: original.functionalMultiplier || 1, 
      corrected: corrected?.functionalMultiplier || original.functionalMultiplier || 1,
      fullName: 'Functional Level'
    },
    { 
      name: 'Comorbidity', 
      original: original.comorbidityMultiplier || 1, 
      corrected: corrected?.comorbidityMultiplier || original.comorbidityMultiplier || 1,
      fullName: 'Comorbidity Adj.'
    },
    { 
      name: 'Admission', 
      original: original.admissionMultiplier || 1, 
      corrected: corrected?.admissionMultiplier || original.admissionMultiplier || 1,
      fullName: 'Admission Source'
    },
    { 
      name: 'Timing', 
      original: original.timingMultiplier || 1, 
      corrected: corrected?.timingMultiplier || original.timingMultiplier || 1,
      fullName: 'Episode Timing'
    },
  ];

  const radarData = componentData.map(item => ({
    subject: item.name,
    Original: item.original,
    Corrected: item.corrected,
    fullMark: 1.5
  }));

  const hasChanges = corrected && (
    original.caseMixWeight !== corrected.caseMixWeight
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">Case-Mix Weight Breakdown</p>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-slate-400 rounded"></span> Original
          </span>
          {hasChanges && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-green-500 rounded"></span> Corrected
            </span>
          )}
        </div>
      </div>

      {/* Radar Chart */}
      <div className="bg-slate-50 rounded-lg p-3">
        <ResponsiveContainer width="100%" height={200}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
            <PolarRadiusAxis angle={90} domain={[0.8, 1.4]} tick={{ fontSize: 9 }} />
            <Radar name="Original" dataKey="Original" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.3} />
            {hasChanges && (
              <Radar name="Corrected" dataKey="Corrected" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
            )}
            <Tooltip formatter={(value) => value.toFixed(4)} />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Component Details Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-100">
            <tr>
              <th className="text-left p-2 font-medium">Component</th>
              <th className="text-center p-2 font-medium">Original</th>
              {hasChanges && <th className="text-center p-2 font-medium">Corrected</th>}
              <th className="text-center p-2 font-medium">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-blue-50">
              <td className="p-2 font-medium">Clinical Group</td>
              <td className="p-2 text-center">
                <span className="block text-slate-600">{original.clinicalGroup?.replace('MMTA_', '')}</span>
                <span className="text-slate-400">{original.clinicalWeight?.toFixed(4)}</span>
              </td>
              {hasChanges && (
                <td className="p-2 text-center">
                  <span className="block text-green-600">{corrected.clinicalGroup?.replace('MMTA_', '')}</span>
                  <span className="text-green-500">{corrected.clinicalWeight?.toFixed(4)}</span>
                </td>
              )}
              <td className="p-2 text-center font-mono text-blue-700">
                {(hasChanges ? corrected : original).clinicalWeight?.toFixed(4)}
              </td>
            </tr>
            <tr>
              <td className="p-2 font-medium">
                Functional Level
                <span className="block text-slate-400 font-normal">Points: {original.functionalPoints || 0}{hasChanges && corrected.functionalPoints !== original.functionalPoints ? ` → ${corrected.functionalPoints}` : ''}</span>
              </td>
              <td className="p-2 text-center">
                <span className="block text-slate-600 capitalize">{original.functionalLevel}</span>
                <span className="text-slate-400">×{original.functionalMultiplier?.toFixed(2)}</span>
              </td>
              {hasChanges && (
                <td className="p-2 text-center">
                  <span className={`block capitalize ${corrected.functionalLevel !== original.functionalLevel ? 'text-green-600' : 'text-slate-600'}`}>
                    {corrected.functionalLevel}
                  </span>
                  <span className={corrected.functionalMultiplier !== original.functionalMultiplier ? 'text-green-500' : 'text-slate-400'}>
                    ×{corrected.functionalMultiplier?.toFixed(2)}
                  </span>
                </td>
              )}
              <td className="p-2 text-center font-mono text-blue-700">
                ×{(hasChanges ? corrected : original).functionalMultiplier?.toFixed(2)}
              </td>
            </tr>
            <tr className="bg-blue-50">
              <td className="p-2 font-medium">
                Comorbidity Adj.
                <span className="block text-slate-400 font-normal">Count: {original.comorbidityCount || 0}{hasChanges && corrected.comorbidityCount !== original.comorbidityCount ? ` → ${corrected.comorbidityCount}` : ''}</span>
              </td>
              <td className="p-2 text-center">
                <span className="block text-slate-600 capitalize">{original.comorbidityLevel}</span>
                <span className="text-slate-400">×{original.comorbidityMultiplier?.toFixed(2)}</span>
              </td>
              {hasChanges && (
                <td className="p-2 text-center">
                  <span className={`block capitalize ${corrected.comorbidityLevel !== original.comorbidityLevel ? 'text-green-600' : 'text-slate-600'}`}>
                    {corrected.comorbidityLevel}
                  </span>
                  <span className={corrected.comorbidityMultiplier !== original.comorbidityMultiplier ? 'text-green-500' : 'text-slate-400'}>
                    ×{corrected.comorbidityMultiplier?.toFixed(2)}
                  </span>
                </td>
              )}
              <td className="p-2 text-center font-mono text-blue-700">
                ×{(hasChanges ? corrected : original).comorbidityMultiplier?.toFixed(2)}
              </td>
            </tr>
            <tr>
              <td className="p-2 font-medium">Admission Source</td>
              <td className="p-2 text-center">
                <span className="block text-slate-600 capitalize">{original.admissionSource}</span>
                <span className="text-slate-400">×{original.admissionMultiplier?.toFixed(2)}</span>
              </td>
              {hasChanges && (
                <td className="p-2 text-center">
                  <span className={`block capitalize ${corrected.admissionSource !== original.admissionSource ? 'text-green-600' : 'text-slate-600'}`}>
                    {corrected.admissionSource}
                  </span>
                  <span className={corrected.admissionMultiplier !== original.admissionMultiplier ? 'text-green-500' : 'text-slate-400'}>
                    ×{corrected.admissionMultiplier?.toFixed(2)}
                  </span>
                </td>
              )}
              <td className="p-2 text-center font-mono text-blue-700">
                ×{(hasChanges ? corrected : original).admissionMultiplier?.toFixed(2)}
              </td>
            </tr>
            <tr className="bg-blue-50">
              <td className="p-2 font-medium">Episode Timing</td>
              <td className="p-2 text-center">
                <span className="block text-slate-600 capitalize">{original.episodeTiming}</span>
                <span className="text-slate-400">×{original.timingMultiplier?.toFixed(2)}</span>
              </td>
              {hasChanges && (
                <td className="p-2 text-center">
                  <span className={`block capitalize ${corrected.episodeTiming !== original.episodeTiming ? 'text-green-600' : 'text-slate-600'}`}>
                    {corrected.episodeTiming}
                  </span>
                  <span className={corrected.timingMultiplier !== original.timingMultiplier ? 'text-green-500' : 'text-slate-400'}>
                    ×{corrected.timingMultiplier?.toFixed(2)}
                  </span>
                </td>
              )}
              <td className="p-2 text-center font-mono text-blue-700">
                ×{(hasChanges ? corrected : original).timingMultiplier?.toFixed(2)}
              </td>
            </tr>
          </tbody>
          <tfoot className="bg-indigo-100">
            <tr>
              <td className="p-2 font-semibold">Final Case-Mix Weight</td>
              <td className="p-2 text-center font-mono font-semibold text-slate-700">
                {original.caseMixWeight?.toFixed(4)}
              </td>
              {hasChanges && (
                <td className="p-2 text-center font-mono font-semibold text-green-700">
                  {corrected.caseMixWeight?.toFixed(4)}
                </td>
              )}
              <td className="p-2 text-center font-mono font-bold text-indigo-700">
                {(hasChanges ? corrected : original).caseMixWeight?.toFixed(4)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Weight Calculation Formula */}
      <div className="bg-indigo-50 p-3 rounded-lg text-xs">
        <p className="font-medium text-indigo-800 mb-1">Case-Mix Calculation</p>
        <p className="text-indigo-600 font-mono">
          Base (${original.basePayment?.toFixed(2)}) × Clinical × Functional × Comorbidity × Admission × Timing
        </p>
        <p className="text-indigo-700 mt-1">
          = ${original.basePayment?.toFixed(2)} × {(hasChanges ? corrected : original).caseMixWeight?.toFixed(4)} = <strong>${(hasChanges ? corrected : original).totalPayment?.toFixed(2)}</strong>
        </p>
      </div>
    </div>
  );
}

export default function PDGMRevenueComparison({ analysisResults, pdgmData, onPaymentCalculated, onRevenueCalculated }) {
  const [isCalculating, setIsCalculating] = useState(false);
  const [revenueData, setRevenueData] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState(null);
  const [hasAutoCalculated, setHasAutoCalculated] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [activeTab, setActiveTab] = useState("analysis");
  const [_whatIfScenario, setWhatIfScenario] = useState(null);
  const [whatIfRevenue, setWhatIfRevenue] = useState(null);
  const [isCalculatingWhatIf, setIsCalculatingWhatIf] = useState(false);
  const [dataValidation, setDataValidation] = useState(null);
  const [alternativeScenarios, setAlternativeScenarios] = useState(null);

  // Reset when pdgmData changes
  useEffect(() => {
    if (!pdgmData) {
      setRevenueData(null);
      setHasAutoCalculated(false);
      setWhatIfScenario(null);
      setWhatIfRevenue(null);
    }
  }, [pdgmData]);

  // Guards so an in-flight calculatePDGM await (which debounce.cancel() can't
  // stop once dispatched) can't write stale revenue when pdgmData changes, or
  // setState after the component unmounts.
  const whatIfReqIdRef = useRef(0);
  const isMountedRef = useRef(true);
  useEffect(() => () => { isMountedRef.current = false; }, []);

  // Debounced What-If calculation
  const calculateWhatIfRevenue = useMemo(
    () => debounce(async (scenarioData) => {
      if (!pdgmData || !scenarioData) return;

      const myReqId = ++whatIfReqIdRef.current;
      setIsCalculatingWhatIf(true);
      try {
        const mergedScenario = {
          ...pdgmData,
          ...scenarioData,
          functional_scores: {
            ...pdgmData.functional_scores,
            ...scenarioData.functional_scores
          }
        };

        const response = await calculatePDGM({
          pdgmData: pdgmData,
          correctedPdgmData: mergedScenario
        });

        if (isMountedRef.current && myReqId === whatIfReqIdRef.current) {
          setWhatIfRevenue(response.data?.corrected?.totalPayment || 0);
        }
      } catch (err) {
        console.error("What-If calculation error:", err);
      } finally {
        if (isMountedRef.current && myReqId === whatIfReqIdRef.current) {
          setIsCalculatingWhatIf(false);
        }
      }
    }, 500),
    [pdgmData]
  );

  // Cancel any pending debounced What-If calculation on unmount
  useEffect(() => () => calculateWhatIfRevenue.cancel(), [calculateWhatIfRevenue]);

  // Handle What-If scenario changes
  const handleScenarioChange = (scenarioData) => {
    setWhatIfScenario(scenarioData);
    calculateWhatIfRevenue(scenarioData);
  };

  const calculateRevenue = useCallback(async () => {
    if (!pdgmData) return;

    setIsCalculating(true);
    setError(null);

    try {
      // Build corrected PDGM data based on AI recommendations
      const correctedPdgmData = buildCorrectedPdgmData(pdgmData, analysisResults);

      // Backend will fetch wage index from agency settings
      const response = await calculatePDGM({
        pdgmData: pdgmData,
        correctedPdgmData: correctedPdgmData
      });

      setRevenueData(response.data);

      // Notify parent of revenue data
      if (onRevenueCalculated && response.data) {
        onRevenueCalculated(response.data);
      }

                // Store validation and scenarios data
                if (response.data?.dataValidation) {
                  setDataValidation(response.data.dataValidation);
                }
                if (response.data?.alternativeScenarios) {
                  setAlternativeScenarios(response.data.alternativeScenarios);
                }

                // Notify parent of original payment for scenario planning
                if (onPaymentCalculated && response.data?.original?.totalPayment) {
                  onPaymentCalculated(response.data.original.totalPayment);
                }
              } catch (err) {
              console.error("Error calculating PDGM:", err);
              setError("Failed to calculate PDGM revenue. Please try again.");
            }

            setIsCalculating(false);
          }, [pdgmData, analysisResults, onRevenueCalculated, onPaymentCalculated]);

  // Auto-calculate when pdgmData becomes available
  useEffect(() => {
    if (pdgmData && !revenueData && !isCalculating && !hasAutoCalculated) {
      calculateRevenue();
      setHasAutoCalculated(true);
    }
  }, [pdgmData, revenueData, isCalculating, hasAutoCalculated, calculateRevenue]);

  const buildCorrectedPdgmData = (original, analysis) => {
    const corrected = JSON.parse(JSON.stringify(original)); // Deep clone
    corrected.functional_scores = corrected.functional_scores || {};
    corrected.comorbidities = corrected.comorbidities || [];

    const maxValues = {
      m1800_grooming: 3,
      m1810_dress_upper: 3,
      m1820_dress_lower: 3,
      m1830_bathing: 6,
      m1840_toilet_transfer: 4,
      m1850_transferring: 5,
      m1860_ambulation: 6
    };

    const itemMap = {
      '1800': 'm1800_grooming',
      '1810': 'm1810_dress_upper',
      '1820': 'm1820_dress_lower',
      '1830': 'm1830_bathing',
      '1840': 'm1840_toilet_transfer',
      '1850': 'm1850_transferring',
      '1860': 'm1860_ambulation'
    };

    const appliedCorrections = [];

    // 1. Apply revenue tips corrections
    if (analysis?.revenue_tips?.length > 0) {
      analysis.revenue_tips.forEach(tip => {
        const impact = tip.potential_impact || 'low';
        const impactMultiplier = impact === 'high' ? 2 : impact === 'medium' ? 1 : 1;

        if (tip.category === 'Functional Status') {
          // Parse specific M-item from tip text
          const mItemMatch = (tip.specific_action + ' ' + tip.opportunity).match(/M18(\d{2})/i);
          if (mItemMatch) {
            const key = itemMap[`18${mItemMatch[1]}`];
            if (key) {
              const newVal = Math.min(maxValues[key], (corrected.functional_scores[key] || 0) + impactMultiplier);
              corrected.functional_scores[key] = newVal;
              appliedCorrections.push({ type: 'functional', item: key, change: `+${impactMultiplier}` });
            }
          } else {
            // General functional improvement - apply to most impactful items
            ['m1830_bathing', 'm1860_ambulation', 'm1850_transferring'].forEach(key => {
              const newVal = Math.min(maxValues[key], (corrected.functional_scores[key] || 0) + impactMultiplier);
              corrected.functional_scores[key] = newVal;
            });
            appliedCorrections.push({ type: 'functional', item: 'multiple', change: `+${impactMultiplier}` });
          }
        }

        if (tip.category === 'Diagnosis' || tip.category === 'Clinical Condition') {
          const diagnosisText = tip.opportunity || tip.specific_action || '';
          if (diagnosisText && !corrected.comorbidities.some(c => c.toLowerCase().includes(diagnosisText.toLowerCase().slice(0, 10)))) {
            corrected.comorbidities.push(diagnosisText);
            appliedCorrections.push({ type: 'diagnosis', item: diagnosisText });
          }
        }

        if (tip.category === 'Therapy') {
          corrected.functional_scores.m1860_ambulation = Math.min(6, (corrected.functional_scores.m1860_ambulation || 0) + impactMultiplier);
          corrected.functional_scores.m1850_transferring = Math.min(5, (corrected.functional_scores.m1850_transferring || 0) + 1);
          appliedCorrections.push({ type: 'therapy', change: 'ambulation/transfer adjusted' });
        }

        if (tip.category === 'Other' && impact === 'high') {
          // High-impact other category - likely affects multiple areas
          corrected.functional_scores.m1840_toilet_transfer = Math.min(4, (corrected.functional_scores.m1840_toilet_transfer || 0) + 1);
          appliedCorrections.push({ type: 'other', change: 'toilet transfer adjusted' });
        }
      });
    }

    // 2. Apply accuracy issue corrections
    if (analysis?.accuracy_issues?.length > 0) {
      analysis.accuracy_issues.forEach(issue => {
        const mItemMatch = issue.item?.match(/M?18(\d{2})/i);
        if (mItemMatch) {
          const key = itemMap[`18${mItemMatch[1]}`];
          if (key) {
            const severityAdd = issue.severity === 'high' ? 2 : issue.severity === 'medium' ? 1 : 1;
            const newVal = Math.min(maxValues[key], (corrected.functional_scores[key] || 0) + severityAdd);
            corrected.functional_scores[key] = newVal;
            appliedCorrections.push({ type: 'accuracy', item: key, severity: issue.severity });
          }
        }

        // Check for diagnosis-related accuracy issues
        if (issue.item?.toLowerCase().includes('diagnosis') || issue.recommendation?.toLowerCase().includes('diagnosis')) {
          const diagMatch = issue.recommendation?.match(/add|include|document[:\s]+([^.]+)/i);
          if (diagMatch && diagMatch[1]) {
            corrected.comorbidities.push(diagMatch[1].trim());
            appliedCorrections.push({ type: 'accuracy_diagnosis', item: diagMatch[1].trim() });
          }
        }

        // Admission source corrections
        if (issue.item?.toLowerCase().includes('m1000') || issue.item?.toLowerCase().includes('admission')) {
          if (issue.recommendation?.toLowerCase().includes('institutional')) {
            corrected.admission_source = 'institutional';
            appliedCorrections.push({ type: 'admission', change: 'institutional' });
          }
        }
      });
    }

    // 3. Apply documentation improvement suggestions
    if (analysis?.documentation_improvements?.length > 0) {
      analysis.documentation_improvements.forEach(imp => {
        const mItemMatch = imp.item?.match(/M?18(\d{2})/i);
        if (mItemMatch) {
          const key = itemMap[`18${mItemMatch[1]}`];
          if (key) {
            const improvedMatch = imp.improved_state?.match(/(\d+)/);
            if (improvedMatch) {
              const suggestedVal = parseInt(improvedMatch[1]);
              if (suggestedVal > (corrected.functional_scores[key] || 0)) {
                corrected.functional_scores[key] = Math.min(maxValues[key], suggestedVal);
                appliedCorrections.push({ type: 'documentation', item: key, value: suggestedVal });
              }
            }
          }
        }

        if (imp.rationale?.toLowerCase().includes('case-mix') || imp.rationale?.toLowerCase().includes('pdgm')) {
          if (!corrected.comorbidities.includes('case-mix relevant condition')) {
            corrected.comorbidities.push('case-mix relevant condition');
            appliedCorrections.push({ type: 'documentation_casemix' });
          }
        }
      });
    }

    // 4. Apply validation issue corrections
    if (analysis?.validation_summary?.issues?.length > 0) {
      analysis.validation_summary.issues.forEach(issue => {
        if (issue.suggested_correction) {
          const mItemMatch = issue.item?.match(/M?18(\d{2})/i);
          if (mItemMatch) {
            const key = itemMap[`18${mItemMatch[1]}`];
            if (key) {
              const valMatch = issue.suggested_correction.match(/(\d+)/);
              if (valMatch) {
                corrected.functional_scores[key] = Math.min(maxValues[key], parseInt(valMatch[1]));
                appliedCorrections.push({ type: 'validation', item: key });
              }
            }
          }
        }
      });
    }

    // Store applied corrections for reference
    corrected._appliedCorrections = appliedCorrections;
    corrected._correctionCount = appliedCorrections.length;

    return corrected;
  };

  const handleDownloadPDF = async () => {
    if (!revenueData) return;

    setIsDownloading(true);
    try {
      const response = await generatePDGMComparisonPDF({
        revenueData,
        analysisResults,
        pdgmData
      });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PDGM_Revenue_Comparison_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error("Error generating PDF:", err);
      setError("Failed to generate PDF report.");
    }
    setIsDownloading(false);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  return (
    <Card className="border-2 border-green-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-600" />
          PDGM Revenue Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {isCalculating ? (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 animate-spin text-green-600 mx-auto mb-3" />
            <p className="text-sm text-slate-600">Calculating PDGM revenue based on OASIS data...</p>
            <p className="text-xs text-slate-400 mt-1">Applying CMS PDGM rules and corrections</p>
          </div>
        ) : !revenueData ? (
          <>
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-800 text-sm">
                {pdgmData 
                  ? "Ready to calculate PDGM revenue based on extracted OASIS data."
                  : "Upload and analyze an OASIS document to calculate PDGM revenue impact."}
              </AlertDescription>
            </Alert>

            <Button
              onClick={calculateRevenue}
              disabled={isCalculating || !pdgmData}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              <Calculator className="w-4 h-4 mr-2" /> Calculate Revenue Impact
            </Button>

            {!pdgmData && (
              <p className="text-xs text-slate-500 text-center">
                PDGM data not available. Run analysis first.
              </p>
            )}
          </>
        ) : (
          <>
            {/* Tabs for different views */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="analysis" className="text-xs gap-1">
                  <DollarSign className="w-3 h-3" />
                  Analysis
                </TabsTrigger>
                <TabsTrigger value="whatif" className="text-xs gap-1">
                  <Sliders className="w-3 h-3" />
                  What-If
                </TabsTrigger>
                <TabsTrigger value="opportunities" className="text-xs gap-1">
                  <Trophy className="w-3 h-3" />
                  Top Tips
                </TabsTrigger>
              </TabsList>

              {/* What-If Tab */}
              <TabsContent value="whatif" className="mt-4 space-y-4">
                <PDGMWhatIfBuilder
                  originalPdgmData={pdgmData}
                  onScenarioChange={handleScenarioChange}
                  originalRevenue={revenueData.original?.totalPayment}
                  scenarioRevenue={isCalculatingWhatIf ? null : whatIfRevenue}
                />
                {isCalculatingWhatIf && (
                  <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Recalculating...
                  </div>
                )}
              </TabsContent>

              {/* Top Opportunities Tab */}
              <TabsContent value="opportunities" className="mt-4">
                <TopOptimizationOpportunities revenueTips={analysisResults?.revenue_tips} />
              </TabsContent>

              {/* Analysis Tab */}
              <TabsContent value="analysis" className="mt-4 space-y-4">
                                {/* Data Validation Warnings */}
                                {dataValidation?.hasDiscrepancies && (
                                  <DataValidationWarnings validation={dataValidation} />
                                )}

                                {/* Alternative Scenarios Comparison */}
                                {alternativeScenarios && (
                                  <AlternativeScenarios 
                                    scenarios={alternativeScenarios} 
                                    currentKey={revenueData.original?.sourceTimingKey} 
                                  />
                                )}

                                {/* Wage Index Display */}
                                {revenueData.wageIndexApplied && revenueData.wageIndexApplied !== 1.0 && (
                                  <Alert className="bg-blue-50 border-blue-200">
                                    <Info className="w-4 h-4 text-blue-600" />
                                    <AlertDescription className="text-blue-800 text-xs">
                                      <strong>Wage Index Applied: {revenueData.wageIndexApplied.toFixed(4)}</strong>
                                      <br />
                                      National Base: ${revenueData.original?.basePayment?.toFixed(2)} × {revenueData.wageIndexApplied.toFixed(4)} = ${revenueData.original?.adjustedBasePayment?.toFixed(2)} (Adjusted Base)
                                    </AlertDescription>
                                  </Alert>
                                )}

                                {/* Revenue Comparison */}
                                <div className="grid grid-cols-2 gap-4">
                                  {/* Original Revenue */}
                                  <div className="p-4 bg-slate-50 rounded-lg border">
                                    <p className="text-xs text-slate-500 mb-1">Current Documentation</p>
                                    <p className="text-2xl font-bold text-slate-700">
                                      {formatCurrency(revenueData.original?.totalPayment || 0)}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-1">
                                      Case-Mix: {revenueData.original?.caseMixWeight?.toFixed(4)}
                                    </p>
                                    {revenueData.original?.wageIndex && revenueData.original.wageIndex !== 1.0 && (
                                      <p className="text-xs text-blue-600 mt-0.5">
                                        Wage Index: {revenueData.original.wageIndex.toFixed(4)}
                                      </p>
                                    )}
                                  </div>

              {/* Corrected Revenue */}
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <p className="text-xs text-green-600 mb-1">With Improvements</p>
                <p className="text-2xl font-bold text-green-700">
                  {formatCurrency(revenueData.corrected?.totalPayment || 0)}
                </p>
                <p className="text-xs text-green-600 mt-1">
                  Case-Mix: {revenueData.corrected?.caseMixWeight?.toFixed(4)}
                </p>
              </div>
            </div>

            {/* Revenue Difference */}
            {revenueData.revenueDifference !== null && (
              <div className={`p-4 rounded-lg border-2 ${
                revenueData.revenueDifference > 0 
                  ? 'bg-gradient-to-r from-green-100 to-emerald-100 border-green-300' 
                  : 'bg-slate-100 border-slate-300'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-slate-600 mb-1">Potential Revenue Increase</p>
                    <p className={`text-3xl font-bold ${
                      revenueData.revenueDifference > 0 ? 'text-green-700' : 'text-slate-700'
                    }`}>
                      {revenueData.revenueDifference > 0 ? '+' : ''}{formatCurrency(revenueData.revenueDifference)}
                    </p>
                  </div>
                  {revenueData.percentageIncrease > 0 && (
                    <div className="flex items-center gap-1 bg-green-600 text-white px-3 py-1 rounded-full">
                      <TrendingUp className="w-4 h-4" />
                      <span className="font-bold">+{revenueData.percentageIncrease}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Annual Impact */}
            {revenueData.financialImpact && (
              <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                <p className="text-sm font-semibold text-indigo-900 mb-3">Projected Annual Impact</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-indigo-600">Per Episode</p>
                    <p className="text-sm font-bold text-indigo-900">
                      {formatCurrency(revenueData.financialImpact.perEpisode)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-indigo-600">30 Episodes/Year</p>
                    <p className="text-sm font-bold text-indigo-900">
                      {formatCurrency(revenueData.financialImpact.annual30Episodes)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-indigo-600">60 Episodes/Year</p>
                    <p className="text-sm font-bold text-indigo-900">
                      {formatCurrency(revenueData.financialImpact.annual60Episodes)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Applied Corrections Detail */}
            {revenueData.corrected?._correctionCount > 0 && (
              <div className="border border-navy-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowCorrections(!showCorrections)}
                  className="w-full flex items-center justify-between p-3 bg-navy-50 hover:bg-navy-100 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-navy-600" />
                    <span className="text-sm font-medium text-navy-800">
                      {revenueData.corrected._correctionCount} Corrections Applied
                    </span>
                  </div>
                  {showCorrections ? (
                    <ChevronUp className="w-4 h-4 text-navy-600" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-navy-600" />
                  )}
                </button>
                
                {showCorrections && revenueData.corrected._appliedCorrections && (
                  <div className="p-3 bg-white space-y-2 max-h-64 overflow-y-auto">
                    {revenueData.corrected._appliedCorrections.map((correction, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-2 bg-slate-50 rounded text-xs">
                        {correction.type === 'functional' && (
                          <Activity className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                        )}
                        {(correction.type === 'diagnosis' || correction.type === 'accuracy_diagnosis' || correction.type === 'documentation_casemix') && (
                          <Stethoscope className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                        )}
                        {(correction.type === 'accuracy' || correction.type === 'validation' || correction.type === 'documentation') && (
                          <ClipboardList className="w-3.5 h-3.5 text-orange-500 mt-0.5 flex-shrink-0" />
                        )}
                        {(correction.type === 'therapy' || correction.type === 'admission' || correction.type === 'other') && (
                          <Wrench className="w-3.5 h-3.5 text-navy-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs py-0 capitalize">
                              {(correction.type || '').replace('_', ' ')}
                            </Badge>
                            {correction.item && correction.item !== 'multiple' && (
                              <span className="font-mono text-navy-700">{correction.item}</span>
                            )}
                            {correction.change && (
                              <span className="text-green-600 font-medium">{correction.change}</span>
                            )}
                            {correction.value !== undefined && (
                              <span className="text-green-600 font-medium">→ {correction.value}</span>
                            )}
                            {correction.severity && (
                              <Badge className={`text-xs py-0 ${
                                correction.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                              }`}>
                                {correction.severity}
                              </Badge>
                            )}
                          </div>
                          <p className="text-slate-600 mt-0.5">
                            {correction.type === 'functional' && correction.item === 'multiple' && 
                              'Increased functional impairment scores (bathing, ambulation, transferring)'}
                            {correction.type === 'functional' && correction.item !== 'multiple' && 
                              `Functional score adjusted based on revenue optimization tip`}
                            {correction.type === 'diagnosis' && 
                              `Added comorbidity: ${correction.item}`}
                            {correction.type === 'accuracy' && 
                              `Corrected ${correction.item} based on accuracy issue`}
                            {correction.type === 'accuracy_diagnosis' && 
                              `Added diagnosis from accuracy recommendation: ${correction.item}`}
                            {correction.type === 'therapy' && 
                              'Adjusted ambulation/transfer scores for therapy needs'}
                            {correction.type === 'admission' && 
                              `Changed admission source to ${correction.change}`}
                            {correction.type === 'documentation' && 
                              `Updated ${correction.item} per documentation improvement`}
                            {correction.type === 'documentation_casemix' && 
                              'Added case-mix relevant condition from documentation'}
                            {correction.type === 'validation' && 
                              `Applied validation correction to ${correction.item}`}
                            {correction.type === 'other' && 
                              'Applied additional optimization adjustment'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Download Button */}
            <Button
              onClick={handleDownloadPDF}
              disabled={isDownloading}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {isDownloading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating PDF...</>
              ) : (
                <><FileDown className="w-4 h-4 mr-2" /> Download PDGM Comparison PDF</>
              )}
            </Button>

            {/* Recalculate */}
            <Button
              onClick={() => setRevenueData(null)}
              variant="outline"
              size="sm"
              className="w-full"
            >
              Recalculate
            </Button>
              </TabsContent>
            </Tabs>
          </>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertDescription className="text-red-800 text-sm">{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}