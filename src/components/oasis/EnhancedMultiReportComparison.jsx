import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Info,
  GitCompare,
  Loader2,
  Activity,
  BarChart3,
  Minus,
  Star,
  Trophy
} from "lucide-react";
import { calculatePDGM } from "@/functions/calculatePDGM";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, 
  PolarRadiusAxis, Radar, Cell
} from 'recharts';

const COLORS = ['#264491', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function EnhancedMultiReportComparison({ 
  savedReports = [], 
  currentReport = null,
  currentPdgmData = null 
}) {
  const [selectedReports, setSelectedReports] = useState([]);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResults, setComparisonResults] = useState(null);
  const [error, setError] = useState(null);

  // Build list of available reports
  const availableReports = useMemo(() => {
    const reports = [];
    
    if (currentReport && currentPdgmData) {
      reports.push({
        id: 'current',
        label: 'Current Analysis',
        shortLabel: 'Current',
        pdgmData: currentPdgmData,
        analysisResults: currentReport,
        timestamp: new Date().toISOString()
      });
    }
    
    savedReports.forEach((report, idx) => {
      if (report.pdgm_data) {
        reports.push({
          id: `saved_${idx}`,
          label: report.fileName || `Report ${idx + 1}`,
          shortLabel: report.fileName?.substring(0, 15) || `Report ${idx + 1}`,
          pdgmData: report.pdgm_data,
          analysisResults: report,
          timestamp: report.timestamp || new Date().toISOString()
        });
      }
    });
    
    return reports;
  }, [savedReports, currentReport, currentPdgmData]);

  const toggleReportSelection = (reportId) => {
    setSelectedReports(prev => {
      if (prev.includes(reportId)) {
        return prev.filter(id => id !== reportId);
      }
      if (prev.length < 4) { // Max 4 reports
        return [...prev, reportId];
      }
      return prev;
    });
  };

  const selectAll = () => {
    setSelectedReports(availableReports.slice(0, 4).map(r => r.id));
  };

  const clearSelection = () => {
    setSelectedReports([]);
    setComparisonResults(null);
  };

  const runComparison = async () => {
    if (selectedReports.length < 2) {
      setError("Please select at least 2 reports to compare");
      return;
    }

    setIsComparing(true);
    setError(null);
    setComparisonResults(null);

    try {
      const reportsToCompare = selectedReports
        .map(id => availableReports.find(r => r.id === id))
        .filter(Boolean);

      // Calculate PDGM for all selected reports
      const pdgmPromises = reportsToCompare.map(report => 
        calculatePDGM({ pdgmData: report.pdgmData })
      );
      
      const pdgmResults = await Promise.all(pdgmPromises);

      // Build comprehensive comparison
      const comparison = buildMultiComparison(reportsToCompare, pdgmResults);
      setComparisonResults(comparison);

    } catch (err) {
      console.error("Comparison error:", err);
      setError(err.message || "Failed to compare reports");
    }

    setIsComparing(false);
  };

  const buildMultiComparison = (reports, pdgmResults) => {
    const reportData = reports.map((report, idx) => ({
      ...report,
      pdgmResult: pdgmResults[idx].data?.original || {},
      revenue: pdgmResults[idx].data?.original?.totalPayment || 0,
      caseMix: pdgmResults[idx].data?.original?.caseMixWeight || 0,
      clinicalGroup: pdgmResults[idx].data?.original?.clinicalGroup || 'Unknown',
      functionalLevel: pdgmResults[idx].data?.original?.functionalLevel || 'Unknown',
      functionalPoints: pdgmResults[idx].data?.original?.functionalPoints || 0,
      comorbidityLevel: pdgmResults[idx].data?.original?.comorbidityLevel || 'none',
      admissionSource: pdgmResults[idx].data?.original?.admissionSource || 'community',
      episodeTiming: pdgmResults[idx].data?.original?.episodeTiming || 'early'
    }));

    // Calculate statistics
    const revenues = reportData.map(r => r.revenue);
    const maxRevenue = Math.max(...revenues);
    const minRevenue = Math.min(...revenues);
    const avgRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length;
    const revenueRange = maxRevenue - minRevenue;

    // Find highest and lowest
    const highestReport = reportData.find(r => r.revenue === maxRevenue);
    const lowestReport = reportData.find(r => r.revenue === minRevenue);

    // Build comparison chart data
    const revenueChartData = reportData.map((r, idx) => ({
      name: r.shortLabel,
      revenue: r.revenue,
      fill: COLORS[idx % COLORS.length],
      isHighest: r.revenue === maxRevenue,
      isLowest: r.revenue === minRevenue
    }));

    // Case-mix component comparison
    const caseMixChartData = reportData.map(r => ({
      name: r.shortLabel,
      Clinical: r.pdgmResult.clinicalWeight || 1,
      Functional: r.pdgmResult.functionalMultiplier || 1,
      Comorbidity: r.pdgmResult.comorbidityMultiplier || 1
    }));

    // Functional points comparison
    const functionalChartData = reportData.map((r, idx) => ({
      name: r.shortLabel,
      points: r.functionalPoints,
      fill: COLORS[idx % COLORS.length]
    }));

    // Radar chart data for overall comparison
    const radarData = ['Clinical', 'Functional', 'Comorbidity'].map(metric => {
      const dataPoint = { subject: metric };
      reportData.forEach((r, _idx) => {
        const key = metric === 'Clinical' ? 'clinicalWeight' : 
                   metric === 'Functional' ? 'functionalMultiplier' : 'comorbidityMultiplier';
        dataPoint[r.shortLabel] = r.pdgmResult[key] || 1;
      });
      return dataPoint;
    });

    // Identify key differences
    const keyDifferences = [];

    // Clinical group differences
    const clinicalGroups = [...new Set(reportData.map(r => r.clinicalGroup))];
    if (clinicalGroups.length > 1) {
      keyDifferences.push({
        type: 'clinical_group',
        severity: 'high',
        title: 'Different Clinical Groups',
        description: `Reports have ${clinicalGroups.length} different clinical groups: ${clinicalGroups.map(g => g.replace('MMTA_', '')).join(', ')}`,
        impact: 'Clinical group is a primary PDGM payment driver'
      });
    }

    // Functional level differences
    const functionalLevels = [...new Set(reportData.map(r => r.functionalLevel))];
    if (functionalLevels.length > 1) {
      keyDifferences.push({
        type: 'functional_level',
        severity: 'high',
        title: 'Varying Functional Levels',
        description: `Functional levels range from ${functionalLevels.join(' to ')}`,
        impact: 'Functional level significantly affects case-mix weight'
      });
    }

    // Admission source differences
    const admissionSources = [...new Set(reportData.map(r => r.admissionSource))];
    if (admissionSources.length > 1) {
      keyDifferences.push({
        type: 'admission_source',
        severity: 'medium',
        title: 'Mixed Admission Sources',
        description: `Reports include both ${admissionSources.join(' and ')} admissions`,
        impact: 'Institutional admissions typically have higher payments'
      });
    }

    // Revenue variance analysis
    if (revenueRange > 500) {
      keyDifferences.push({
        type: 'revenue_variance',
        severity: revenueRange > 1000 ? 'high' : 'medium',
        title: `Revenue Variance: ${formatCurrency(revenueRange)}`,
        description: `Payments range from ${formatCurrency(minRevenue)} to ${formatCurrency(maxRevenue)}`,
        impact: `${highestReport?.shortLabel} generates ${formatCurrency(revenueRange)} more than ${lowestReport?.shortLabel}`
      });
    }

    return {
      reports: reportData,
      statistics: {
        maxRevenue,
        minRevenue,
        avgRevenue,
        revenueRange,
        highestReport,
        lowestReport
      },
      charts: {
        revenue: revenueChartData,
        caseMix: caseMixChartData,
        functional: functionalChartData,
        radar: radarData
      },
      keyDifferences
    };
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (availableReports.length < 2) {
    return (
      <Card className="border-2 border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-slate-400" />
            Multi-Report Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="bg-slate-50 border-slate-200">
            <Info className="w-4 h-4 text-slate-500" />
            <AlertDescription className="text-slate-600 text-sm">
              Upload and analyze at least 2 OASIS documents to enable comparison. Use batch analysis for multiple documents.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-navy-600" />
            Multi-Report PDGM Comparison
          </div>
          <Badge variant="outline" className="text-xs">
            {availableReports.length} reports available
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Report Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Select Reports to Compare (2-4)</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7">
                Select All
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection} className="text-xs h-7">
                Clear
              </Button>
            </div>
          </div>

          <ScrollArea className="h-32 rounded border p-2">
            <div className="space-y-2">
              {availableReports.map((report, idx) => (
                <div 
                  key={report.id}
                  className={`flex items-center gap-3 p-2 rounded-lg border transition-colors cursor-pointer ${
                    selectedReports.includes(report.id) 
                      ? 'bg-navy-50 border-navy-300' 
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                  onClick={() => toggleReportSelection(report.id)}
                >
                  <Checkbox 
                    checked={selectedReports.includes(report.id)}
                    className="pointer-events-none"
                  />
                  <div 
                    className="w-3 h-3 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{report.label}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {report.pdgmData?.primary_diagnosis?.substring(0, 40) || 'No diagnosis'}
                    </p>
                  </div>
                  {report.id === 'current' && (
                    <Badge className="bg-blue-100 text-blue-700 text-xs">Current</Badge>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className={selectedReports.length >= 2 ? 'text-green-700' : 'text-slate-500'}>
              {selectedReports.length} selected
            </Badge>
            {selectedReports.length < 2 && (
              <span className="text-xs text-slate-500">Select at least 2 reports</span>
            )}
          </div>
        </div>

        {/* Compare Button */}
        <Button
          onClick={runComparison}
          disabled={isComparing || selectedReports.length < 2}
          className="w-full bg-navy-600 hover:bg-navy-700"
        >
          {isComparing ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Comparing {selectedReports.length} Reports...</>
          ) : (
            <><BarChart3 className="w-4 h-4 mr-2" /> Compare {selectedReports.length} Reports</>
          )}
        </Button>

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm">{error}</AlertDescription>
          </Alert>
        )}

        {/* Comparison Results */}
        {comparisonResults && (
          <div className="space-y-4 pt-2">
            {/* Summary Stats */}
            <div className="grid grid-cols-4 gap-2">
              <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-center">
                <Trophy className="w-4 h-4 text-green-600 mx-auto mb-1" />
                <p className="text-xs text-green-600">Highest</p>
                <p className="text-sm font-bold text-green-700">
                  {formatCurrency(comparisonResults.statistics.maxRevenue)}
                </p>
                <p className="text-xs text-green-600 truncate">
                  {comparisonResults.statistics.highestReport?.shortLabel}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border text-center">
                <Minus className="w-4 h-4 text-slate-500 mx-auto mb-1" />
                <p className="text-xs text-slate-500">Lowest</p>
                <p className="text-sm font-bold text-slate-700">
                  {formatCurrency(comparisonResults.statistics.minRevenue)}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {comparisonResults.statistics.lowestReport?.shortLabel}
                </p>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-center">
                <BarChart3 className="w-4 h-4 text-blue-600 mx-auto mb-1" />
                <p className="text-xs text-blue-600">Average</p>
                <p className="text-sm font-bold text-blue-700">
                  {formatCurrency(comparisonResults.statistics.avgRevenue)}
                </p>
              </div>
              <div className="p-3 bg-navy-50 rounded-lg border border-navy-200 text-center">
                <TrendingUp className="w-4 h-4 text-navy-600 mx-auto mb-1" />
                <p className="text-xs text-navy-600">Range</p>
                <p className="text-sm font-bold text-navy-700">
                  {formatCurrency(comparisonResults.statistics.revenueRange)}
                </p>
              </div>
            </div>

            {/* Revenue Comparison Chart */}
            <div className="bg-slate-50 rounded-lg p-4 border">
              <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-600" />
                Revenue Comparison
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={comparisonResults.charts.revenue}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `$${(v/1000).toFixed(1)}k`} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {comparisonResults.charts.revenue.map((entry, idx) => (
                      <Cell 
                        key={idx} 
                        fill={entry.isHighest ? '#22c55e' : entry.isLowest ? '#9ca3af' : entry.fill} 
                        stroke={entry.isHighest ? '#16a34a' : 'transparent'}
                        strokeWidth={entry.isHighest ? 2 : 0}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Case-Mix Components Radar */}
            <div className="bg-slate-50 rounded-lg p-4 border">
              <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-navy-600" />
                Case-Mix Component Comparison
              </p>
              <ResponsiveContainer width="100%" height={250}>
                <RadarChart data={comparisonResults.charts.radar}>
                  <PolarGrid stroke="#e5e7eb" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis angle={90} domain={[0.7, 1.5]} tick={{ fontSize: 9 }} />
                  {comparisonResults.reports.map((report, idx) => (
                    <Radar 
                      key={report.id}
                      name={report.shortLabel} 
                      dataKey={report.shortLabel} 
                      stroke={COLORS[idx % COLORS.length]} 
                      fill={COLORS[idx % COLORS.length]} 
                      fillOpacity={0.2} 
                    />
                  ))}
                  <Tooltip formatter={(value) => value.toFixed(4)} />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Detailed Report Table */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead className="text-center">Revenue</TableHead>
                  <TableHead className="text-center">Clinical Group</TableHead>
                  <TableHead className="text-center">Functional</TableHead>
                  <TableHead className="text-center">Comorbidity</TableHead>
                  <TableHead className="text-center">Source/Timing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonResults.reports.map((report, idx) => (
                  <TableRow key={report.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                        <span className="font-medium">{report.shortLabel}</span>
                        {report.revenue === comparisonResults.statistics.maxRevenue && (
                          <Star className="w-3 h-3 text-gold-500 fill-gold-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`font-bold ${
                        report.revenue === comparisonResults.statistics.maxRevenue ? 'text-emerald-700' :
                        report.revenue === comparisonResults.statistics.minRevenue ? 'text-slate-500' :
                        'text-slate-700'
                      }`}>
                        {formatCurrency(report.revenue)}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-xs">
                        {report.clinicalGroup?.replace('MMTA_', '')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="capitalize">{report.functionalLevel}</span>
                      <span className="text-slate-400 ml-1">({report.functionalPoints}pts)</span>
                    </TableCell>
                    <TableCell className="text-center capitalize">{report.comorbidityLevel}</TableCell>
                    <TableCell className="text-center">
                      <span className="capitalize">{report.admissionSource}</span>
                      <span className="text-slate-400"> / </span>
                      <span className="capitalize">{report.episodeTiming}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Key Differences */}
            {comparisonResults.keyDifferences.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Key Differences & Insights
                </p>
                {comparisonResults.keyDifferences.map((diff, idx) => (
                  <Alert 
                    key={idx} 
                    className={`${
                      diff.severity === 'high' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
                    }`}
                  >
                    <Info className={`w-4 h-4 ${diff.severity === 'high' ? 'text-red-600' : 'text-yellow-600'}`} />
                    <AlertDescription>
                      <p className="font-semibold text-sm">{diff.title}</p>
                      <p className="text-xs text-slate-700 mt-1">{diff.description}</p>
                      <p className="text-xs text-navy-700 mt-1 font-medium">💡 {diff.impact}</p>
                    </AlertDescription>
                  </Alert>
                ))}
              </div>
            )}

            {/* Success message if no major differences */}
            {comparisonResults.keyDifferences.length === 0 && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-800 text-sm">
                  All selected reports show consistent PDGM scoring patterns with minimal variance.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}