import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Info,
  FileText,
  GitCompare,
  Loader2,
  Activity,
  Stethoscope,
  Heart,
  Scale
} from "lucide-react";
import { calculatePDGM } from "@/functions/calculatePDGM";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';

// Default baseline representing average/standard PDGM values
const DEFAULT_BASELINE = {
  primary_diagnosis: "Baseline (Average Patient)",
  primary_diagnosis_code: "",
  comorbidities: [],
  admission_source: "community",
  episode_timing: "early",
  functional_scores: {
    m1800_grooming: 1,
    m1810_dress_upper: 1,
    m1820_dress_lower: 1,
    m1830_bathing: 2,
    m1840_toilet_transfer: 1,
    m1850_transferring: 2,
    m1860_ambulation: 2
  }
};

export default function PDGMMultiReportComparison({ 
  savedReports = [], 
  currentReport = null,
  currentPdgmData = null 
}) {
  const [compareMode, setCompareMode] = useState("baseline"); // "baseline" or "reports"
  const [selectedReportA, setSelectedReportA] = useState(null);
  const [selectedReportB, setSelectedReportB] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState(null);
  const [error, setError] = useState(null);

  // Build list of available reports for selection
  const availableReports = useMemo(() => {
    const reports = [];
    
    // Add current report if available
    if (currentReport && currentPdgmData) {
      reports.push({
        id: 'current',
        label: 'Current Analysis',
        pdgmData: currentPdgmData,
        analysisResults: currentReport,
        timestamp: new Date().toISOString()
      });
    }
    
    // Add saved reports from batch analysis
    savedReports.forEach((report, idx) => {
      if (report.pdgm_data) {
        reports.push({
          id: `saved_${idx}`,
          label: report.fileName || `Report ${idx + 1}`,
          pdgmData: report.pdgm_data,
          analysisResults: report,
          timestamp: report.timestamp || new Date().toISOString()
        });
      }
    });
    
    return reports;
  }, [savedReports, currentReport, currentPdgmData]);

  const runComparison = async () => {
    setIsComparing(true);
    setError(null);
    setComparisonResult(null);

    try {
      let dataA, dataB;

      if (compareMode === "baseline") {
        // Compare current/selected report against baseline
        const selectedData = selectedReportA 
          ? availableReports.find(r => r.id === selectedReportA)?.pdgmData 
          : currentPdgmData;
        
        if (!selectedData) {
          throw new Error("No report selected for comparison");
        }
        
        dataA = DEFAULT_BASELINE;
        dataB = selectedData;
      } else {
        // Compare two reports
        const reportA = availableReports.find(r => r.id === selectedReportA);
        const reportB = availableReports.find(r => r.id === selectedReportB);
        
        if (!reportA || !reportB) {
          throw new Error("Please select two reports to compare");
        }
        
        dataA = reportA.pdgmData;
        dataB = reportB.pdgmData;
      }

      // Calculate PDGM for both
      const [resultA, resultB] = await Promise.all([
        calculatePDGM({ pdgmData: dataA }),
        calculatePDGM({ pdgmData: dataB })
      ]);

      // Build comparison analysis
      const comparison = buildComparisonAnalysis(
        dataA, 
        dataB, 
        resultA.data, 
        resultB.data,
        compareMode === "baseline" ? "Baseline" : availableReports.find(r => r.id === selectedReportA)?.label,
        compareMode === "baseline" ? (availableReports.find(r => r.id === selectedReportA)?.label || "Current") : availableReports.find(r => r.id === selectedReportB)?.label
      );

      setComparisonResult(comparison);
    } catch (err) {
      console.error("Comparison error:", err);
      setError(err.message || "Failed to compare reports");
    }

    setIsComparing(false);
  };

  const buildComparisonAnalysis = (dataA, dataB, resultA, resultB, labelA, labelB) => {
    const revenueDiff = (resultB.original?.totalPayment || 0) - (resultA.original?.totalPayment || 0);
    const percentDiff = resultA.original?.totalPayment 
      ? ((revenueDiff / resultA.original.totalPayment) * 100).toFixed(1)
      : 0;

    // Diagnosis comparison
    const diagnosisChanges = [];
    if (dataA.primary_diagnosis !== dataB.primary_diagnosis) {
      diagnosisChanges.push({
        type: 'primary_diagnosis',
        label: 'Primary Diagnosis',
        valueA: dataA.primary_diagnosis || 'Not specified',
        valueB: dataB.primary_diagnosis || 'Not specified',
        impact: resultA.original?.clinicalGroup !== resultB.original?.clinicalGroup ? 'high' : 'medium',
        explanation: resultA.original?.clinicalGroup !== resultB.original?.clinicalGroup 
          ? `Clinical group changed from ${resultA.original?.clinicalGroup?.replace('MMTA_', '')} to ${resultB.original?.clinicalGroup?.replace('MMTA_', '')}, affecting base reimbursement rate.`
          : 'Primary diagnosis changed but clinical group remains the same.'
      });
    }

    // Comorbidity comparison
    const comorbA = new Set(dataA.comorbidities || []);
    const comorbB = new Set(dataB.comorbidities || []);
    const addedComorbidities = [...comorbB].filter(c => !comorbA.has(c));
    const removedComorbidities = [...comorbA].filter(c => !comorbB.has(c));
    
    if (addedComorbidities.length > 0 || removedComorbidities.length > 0) {
      const comorbLevelChanged = resultA.original?.comorbidityLevel !== resultB.original?.comorbidityLevel;
      diagnosisChanges.push({
        type: 'comorbidities',
        label: 'Comorbidities',
        valueA: `${dataA.comorbidities?.length || 0} conditions`,
        valueB: `${dataB.comorbidities?.length || 0} conditions`,
        added: addedComorbidities,
        removed: removedComorbidities,
        impact: comorbLevelChanged ? 'high' : 'low',
        explanation: comorbLevelChanged
          ? `Comorbidity adjustment changed from ${resultA.original?.comorbidityLevel} to ${resultB.original?.comorbidityLevel} (×${resultA.original?.comorbidityMultiplier?.toFixed(2)} → ×${resultB.original?.comorbidityMultiplier?.toFixed(2)}).`
          : `Comorbidity count changed but adjustment level remains ${resultB.original?.comorbidityLevel}.`
      });
    }

    // Functional score comparison
    const functionalChanges = [];
    const scoreLabels = {
      m1800_grooming: 'M1800 Grooming',
      m1810_dress_upper: 'M1810 Upper Dress',
      m1820_dress_lower: 'M1820 Lower Dress',
      m1830_bathing: 'M1830 Bathing',
      m1840_toilet_transfer: 'M1840 Toilet Transfer',
      m1850_transferring: 'M1850 Transferring',
      m1860_ambulation: 'M1860 Ambulation'
    };

    Object.keys(scoreLabels).forEach(key => {
      const valA = dataA.functional_scores?.[key] || 0;
      const valB = dataB.functional_scores?.[key] || 0;
      if (valA !== valB) {
        functionalChanges.push({
          item: key,
          label: scoreLabels[key],
          valueA: valA,
          valueB: valB,
          change: valB - valA,
          direction: valB > valA ? 'increased' : 'decreased'
        });
      }
    });

    const functionalPointsA = resultA.original?.functionalPoints || 0;
    const functionalPointsB = resultB.original?.functionalPoints || 0;
    const functionalLevelChanged = resultA.original?.functionalLevel !== resultB.original?.functionalLevel;

    // Admission & timing comparison
    const adminChanges = [];
    if (dataA.admission_source !== dataB.admission_source) {
      adminChanges.push({
        type: 'admission_source',
        label: 'Admission Source',
        valueA: dataA.admission_source || 'community',
        valueB: dataB.admission_source || 'community',
        multiplierA: resultA.original?.admissionMultiplier,
        multiplierB: resultB.original?.admissionMultiplier
      });
    }
    if (dataA.episode_timing !== dataB.episode_timing) {
      adminChanges.push({
        type: 'episode_timing',
        label: 'Episode Timing',
        valueA: dataA.episode_timing || 'early',
        valueB: dataB.episode_timing || 'early',
        multiplierA: resultA.original?.timingMultiplier,
        multiplierB: resultB.original?.timingMultiplier
      });
    }

    // Generate explanations for significant discrepancies
    const explanations = [];
    
    if (Math.abs(revenueDiff) > 500) {
      const factors = [];
      if (resultA.original?.clinicalGroup !== resultB.original?.clinicalGroup) {
        factors.push(`clinical group change (${resultA.original?.clinicalGroup?.replace('MMTA_', '')} → ${resultB.original?.clinicalGroup?.replace('MMTA_', '')})`);
      }
      if (functionalLevelChanged) {
        factors.push(`functional level change (${resultA.original?.functionalLevel} → ${resultB.original?.functionalLevel})`);
      }
      if (resultA.original?.comorbidityLevel !== resultB.original?.comorbidityLevel) {
        factors.push(`comorbidity adjustment change`);
      }
      if (adminChanges.length > 0) {
        factors.push(`admission/timing changes`);
      }
      
      explanations.push({
        type: 'revenue_impact',
        severity: Math.abs(revenueDiff) > 1000 ? 'high' : 'medium',
        title: `Significant Revenue ${revenueDiff > 0 ? 'Increase' : 'Decrease'}: ${formatCurrency(Math.abs(revenueDiff))}`,
        description: factors.length > 0 
          ? `Primary drivers: ${factors.join(', ')}.`
          : 'Multiple small changes contributing to overall difference.',
        recommendation: revenueDiff > 0 
          ? 'Ensure documentation supports the higher acuity scores to avoid audit risk.'
          : 'Review documentation for potential underscoring opportunities.'
      });
    }

    if (functionalLevelChanged) {
      explanations.push({
        type: 'functional_level',
        severity: 'high',
        title: `Functional Level Changed: ${resultA.original?.functionalLevel} → ${resultB.original?.functionalLevel}`,
        description: `Total functional points changed from ${functionalPointsA} to ${functionalPointsB}. PDGM uses thresholds at 0-5 (Low), 6-11 (Medium), 12+ (High) points.`,
        recommendation: 'Verify functional assessments are accurately documented with specific examples of patient limitations.'
      });
    }

    return {
      labelA,
      labelB,
      revenueA: resultA.original?.totalPayment || 0,
      revenueB: resultB.original?.totalPayment || 0,
      revenueDifference: revenueDiff,
      percentageDifference: percentDiff,
      caseMixA: resultA.original?.caseMixWeight || 0,
      caseMixB: resultB.original?.caseMixWeight || 0,
      diagnosisChanges,
      functionalChanges,
      functionalPointsA,
      functionalPointsB,
      functionalLevelA: resultA.original?.functionalLevel,
      functionalLevelB: resultB.original?.functionalLevel,
      functionalLevelChanged,
      adminChanges,
      explanations,
      resultA: resultA.original,
      resultB: resultB.original
    };
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getImpactColor = (impact) => {
    switch (impact) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  // Radar chart data for visual comparison
  const radarData = comparisonResult ? [
    { subject: 'Clinical', A: comparisonResult.resultA?.clinicalWeight || 1, B: comparisonResult.resultB?.clinicalWeight || 1 },
    { subject: 'Functional', A: comparisonResult.resultA?.functionalMultiplier || 1, B: comparisonResult.resultB?.functionalMultiplier || 1 },
    { subject: 'Comorbidity', A: comparisonResult.resultA?.comorbidityMultiplier || 1, B: comparisonResult.resultB?.comorbidityMultiplier || 1 },
    { subject: 'Admission', A: comparisonResult.resultA?.admissionMultiplier || 1, B: comparisonResult.resultB?.admissionMultiplier || 1 },
    { subject: 'Timing', A: comparisonResult.resultA?.timingMultiplier || 1, B: comparisonResult.resultB?.timingMultiplier || 1 },
  ] : [];

  // Bar chart for functional scores
  const functionalBarData = comparisonResult?.functionalChanges?.length > 0 
    ? comparisonResult.functionalChanges.map(fc => ({
        name: (fc.label || '').replace('M18', 'M18').split(' ')[0],
        [comparisonResult.labelA]: fc.valueA,
        [comparisonResult.labelB]: fc.valueB
      }))
    : [];

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <GitCompare className="w-5 h-5 text-indigo-600" />
          Multi-Report PDGM Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Mode Selection */}
        <Tabs value={compareMode} onValueChange={setCompareMode}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="baseline" className="text-xs">
              <Scale className="w-3.5 h-3.5 mr-1" />
              vs Baseline
            </TabsTrigger>
            <TabsTrigger value="reports" className="text-xs">
              <FileText className="w-3.5 h-3.5 mr-1" />
              Compare Reports
            </TabsTrigger>
          </TabsList>

          <TabsContent value="baseline" className="mt-4 space-y-3">
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-800 text-sm">
                Compare a report against a standard baseline to see how it differs from average values.
              </AlertDescription>
            </Alert>

            <div>
              <label htmlFor="pdgm-baseline-report" className="text-xs font-medium text-slate-700 mb-1 block">Select Report to Compare</label>
              <Select value={selectedReportA || 'current'} onValueChange={setSelectedReportA}>
                <SelectTrigger id="pdgm-baseline-report">
                  <SelectValue placeholder="Select a report" />
                </SelectTrigger>
                <SelectContent>
                  {availableReports.length > 0 ? (
                    availableReports.map(report => (
                      <SelectItem key={report.id} value={report.id}>
                        {report.label}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>No reports available</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="reports" className="mt-4 space-y-3">
            <Alert className="bg-navy-50 border-navy-200">
              <Info className="w-4 h-4 text-navy-600" />
              <AlertDescription className="text-navy-800 text-sm">
                Compare two OASIS analysis reports side-by-side to identify differences.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pdgm-report-a" className="text-xs font-medium text-slate-700 mb-1 block">Report A</label>
                <Select value={selectedReportA || ''} onValueChange={setSelectedReportA}>
                  <SelectTrigger id="pdgm-report-a">
                    <SelectValue placeholder="Select first report" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableReports.map(report => (
                      <SelectItem key={report.id} value={report.id} disabled={report.id === selectedReportB}>
                        {report.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="pdgm-report-b" className="text-xs font-medium text-slate-700 mb-1 block">Report B</label>
                <Select value={selectedReportB || ''} onValueChange={setSelectedReportB}>
                  <SelectTrigger id="pdgm-report-b">
                    <SelectValue placeholder="Select second report" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableReports.map(report => (
                      <SelectItem key={report.id} value={report.id} disabled={report.id === selectedReportA}>
                        {report.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Compare Button */}
        <Button
          onClick={runComparison}
          disabled={isComparing || (compareMode === 'reports' && (!selectedReportA || !selectedReportB))}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {isComparing ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Comparing...</>
          ) : (
            <><GitCompare className="w-4 h-4 mr-2" /> Run Comparison</>
          )}
        </Button>

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {/* Comparison Results */}
        {comparisonResult && (
          <div className="space-y-4 pt-2">
            {/* Revenue Summary */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 bg-slate-50 rounded-lg border text-center">
                <p className="text-xs text-slate-500 mb-1">{comparisonResult.labelA}</p>
                <p className="text-lg font-bold text-slate-700">{formatCurrency(comparisonResult.revenueA)}</p>
                <p className="text-xs text-slate-400">CMW: {comparisonResult.caseMixA?.toFixed(4)}</p>
              </div>
              <div className="p-3 flex items-center justify-center">
                <ArrowRight className="w-6 h-6 text-slate-400" />
              </div>
              <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-200 text-center">
                <p className="text-xs text-indigo-600 mb-1">{comparisonResult.labelB}</p>
                <p className="text-lg font-bold text-indigo-700">{formatCurrency(comparisonResult.revenueB)}</p>
                <p className="text-xs text-indigo-500">CMW: {comparisonResult.caseMixB?.toFixed(4)}</p>
              </div>
            </div>

            {/* Revenue Difference */}
            <div className={`p-4 rounded-lg border-2 ${
              comparisonResult.revenueDifference > 0 
                ? 'bg-green-50 border-green-300' 
                : comparisonResult.revenueDifference < 0 
                  ? 'bg-red-50 border-red-300'
                  : 'bg-slate-50 border-slate-300'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-600 mb-1">Revenue Difference</p>
                  <p className={`text-2xl font-bold ${
                    comparisonResult.revenueDifference > 0 ? 'text-green-700' : 
                    comparisonResult.revenueDifference < 0 ? 'text-red-700' : 'text-slate-700'
                  }`}>
                    {comparisonResult.revenueDifference > 0 ? '+' : ''}{formatCurrency(comparisonResult.revenueDifference)}
                  </p>
                </div>
                <div className={`flex items-center gap-1 px-3 py-1 rounded-full ${
                  comparisonResult.revenueDifference > 0 ? 'bg-green-600 text-white' :
                  comparisonResult.revenueDifference < 0 ? 'bg-red-600 text-white' : 'bg-slate-400 text-white'
                }`}>
                  {comparisonResult.revenueDifference > 0 ? <TrendingUp className="w-4 h-4" /> : 
                   comparisonResult.revenueDifference < 0 ? <TrendingDown className="w-4 h-4" /> : null}
                  <span className="font-bold">{comparisonResult.percentageDifference > 0 ? '+' : ''}{comparisonResult.percentageDifference}%</span>
                </div>
              </div>
            </div>

            {/* Radar Chart Comparison */}
            <div className="bg-slate-50 rounded-lg p-3 border">
              <p className="text-xs font-medium text-slate-700 mb-2">Case-Mix Component Comparison</p>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10 }} />
                  <PolarRadiusAxis angle={90} domain={[0.8, 1.4]} tick={{ fontSize: 9 }} />
                  <Radar name={comparisonResult.labelA} dataKey="A" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.3} />
                  <Radar name={comparisonResult.labelB} dataKey="B" stroke="#264491" fill="#264491" fillOpacity={0.3} />
                  <Tooltip formatter={(value) => value.toFixed(4)} />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Diagnosis Changes */}
            {comparisonResult.diagnosisChanges.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-green-600" />
                  Diagnosis Changes
                </p>
                {comparisonResult.diagnosisChanges.map((change, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border ${getImpactColor(change.impact)}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{change.label}</span>
                      <Badge className={change.impact === 'high' ? 'bg-red-600' : 'bg-yellow-500'}>
                        {change.impact} impact
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                      <div className="bg-white/50 p-2 rounded">
                        <span className="text-slate-500">Before: </span>
                        <span className="font-medium">{change.valueA}</span>
                      </div>
                      <div className="bg-white/50 p-2 rounded">
                        <span className="text-slate-500">After: </span>
                        <span className="font-medium">{change.valueB}</span>
                      </div>
                    </div>
                    {change.added?.length > 0 && (
                      <p className="text-xs text-green-700">+ Added: {change.added.slice(0, 3).join(', ')}{change.added.length > 3 ? ` (+${change.added.length - 3} more)` : ''}</p>
                    )}
                    {change.removed?.length > 0 && (
                      <p className="text-xs text-red-700">- Removed: {change.removed.slice(0, 3).join(', ')}{change.removed.length > 3 ? ` (+${change.removed.length - 3} more)` : ''}</p>
                    )}
                    <p className="text-xs text-slate-700 mt-1">{change.explanation}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Functional Score Changes */}
            {comparisonResult.functionalChanges.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  Functional Score Changes
                  {comparisonResult.functionalLevelChanged && (
                    <Badge className="bg-red-600 text-white">Level Changed</Badge>
                  )}
                </p>
                
                {/* Functional Points Summary */}
                <div className={`p-3 rounded-lg border ${comparisonResult.functionalLevelChanged ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
                  <div className="flex items-center justify-between text-sm">
                    <span>Total Points: {comparisonResult.functionalPointsA} → {comparisonResult.functionalPointsB}</span>
                    <span className="font-medium">
                      Level: {comparisonResult.functionalLevelA} → {comparisonResult.functionalLevelB}
                    </span>
                  </div>
                </div>

                {/* Bar Chart for functional scores */}
                {functionalBarData.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-3 border">
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={functionalBarData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" domain={[0, 6]} tick={{ fontSize: 10 }} />
                        <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={50} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey={comparisonResult.labelA} fill="#9ca3af" />
                        <Bar dataKey={comparisonResult.labelB} fill="#264491" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Individual changes */}
                <div className="grid grid-cols-2 gap-2">
                  {comparisonResult.functionalChanges.map((fc, idx) => (
                    <div key={idx} className={`p-2 rounded border text-xs ${
                      fc.direction === 'increased' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                    }`}>
                      <span className="font-medium">{fc.label}</span>
                      <div className="flex items-center gap-1 mt-1">
                        <span>{fc.valueA}</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className={fc.direction === 'increased' ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
                          {fc.valueB}
                        </span>
                        <span className={fc.direction === 'increased' ? 'text-green-600' : 'text-red-600'}>
                          ({fc.change > 0 ? '+' : ''}{fc.change})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Admin/Timing Changes */}
            {comparisonResult.adminChanges.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Heart className="w-4 h-4 text-navy-600" />
                  Admission & Timing Changes
                </p>
                {comparisonResult.adminChanges.map((change, idx) => (
                  <div key={idx} className="p-2 rounded border bg-navy-50 border-navy-200 text-xs">
                    <span className="font-medium">{change.label}: </span>
                    <span className="capitalize">{change.valueA}</span>
                    <span className="text-slate-400 mx-1">(×{change.multiplierA?.toFixed(2)})</span>
                    <ArrowRight className="w-3 h-3 inline mx-1" />
                    <span className="capitalize font-medium text-navy-700">{change.valueB}</span>
                    <span className="text-navy-500 mx-1">(×{change.multiplierB?.toFixed(2)})</span>
                  </div>
                ))}
              </div>
            )}

            {/* Explanations */}
            {comparisonResult.explanations.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Info className="w-4 h-4 text-indigo-600" />
                  Key Insights & Explanations
                </p>
                {comparisonResult.explanations.map((exp, idx) => (
                  <Alert key={idx} className={exp.severity === 'high' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}>
                    <AlertTriangle className={`w-4 h-4 ${exp.severity === 'high' ? 'text-red-600' : 'text-yellow-600'}`} />
                    <AlertDescription>
                      <p className="font-semibold text-sm">{exp.title}</p>
                      <p className="text-xs text-slate-700 mt-1">{exp.description}</p>
                      <p className="text-xs text-indigo-700 mt-2 font-medium">
                        💡 {exp.recommendation}
                      </p>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {/* No significant changes message */}
            {comparisonResult.diagnosisChanges.length === 0 && 
             comparisonResult.functionalChanges.length === 0 && 
             comparisonResult.adminChanges.length === 0 && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-800 text-sm">
                  No significant differences found between the two reports. The PDGM scoring is consistent.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}