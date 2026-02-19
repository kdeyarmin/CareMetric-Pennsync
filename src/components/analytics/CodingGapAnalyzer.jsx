import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertTriangle, TrendingUp, DollarSign, FileText } from 'lucide-react';

export default function CodingGapAnalyzer() {
  const { data: pdgmRecords } = useQuery({
    queryKey: ['pdgm-records'],
    queryFn: () => base44.entities.PDGMCaseMix.filter({})
  });

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.filter({})
  });

  // Analyze gaps
  const gaps = React.useMemo(() => {
    if (!pdgmRecords || !patients) return [];

    const gapAnalysis = [];

    pdgmRecords.forEach(record => {
      const patient = patients.find(p => p.id === record.patient_id);
      
      // Check for optimization opportunities
      if (record.optimization_opportunities && record.optimization_opportunities.length > 0) {
        record.optimization_opportunities.forEach(opp => {
          gapAnalysis.push({
            patient_name: patient?.full_name || 'Unknown',
            patient_id: record.patient_id,
            gap_type: 'coding_optimization',
            area: opp.area,
            current: opp.current_value,
            recommended: opp.recommended_value,
            financial_impact: opp.impact,
            rationale: opp.rationale,
            severity: opp.impact > 500 ? 'high' : opp.impact > 200 ? 'medium' : 'low'
          });
        });
      }

      // Check for low optimization scores
      if (record.optimization_score < 80) {
        gapAnalysis.push({
          patient_name: patient?.full_name || 'Unknown',
          patient_id: record.patient_id,
          gap_type: 'low_optimization',
          area: 'Overall PDGM Optimization',
          current: `${record.optimization_score}%`,
          recommended: '90%+',
          financial_impact: 0,
          rationale: 'Multiple optimization opportunities identified',
          severity: record.optimization_score < 60 ? 'high' : 'medium'
        });
      }

      // Check for LUPA risk
      if (record.actual_visits > 0 && record.actual_visits < record.lupa_threshold_visits) {
        const visitGap = record.lupa_threshold_visits - record.actual_visits;
        gapAnalysis.push({
          patient_name: patient?.full_name || 'Unknown',
          patient_id: record.patient_id,
          gap_type: 'lupa_risk',
          area: 'Visit Threshold',
          current: `${record.actual_visits} visits`,
          recommended: `${record.lupa_threshold_visits} visits minimum`,
          financial_impact: visitGap * 150, // Estimated impact
          rationale: `Patient is ${visitGap} visit(s) away from LUPA threshold`,
          severity: 'high'
        });
      }
    });

    return gapAnalysis.sort((a, b) => b.financial_impact - a.financial_impact);
  }, [pdgmRecords, patients]);

  const totalPotentialRevenue = gaps.reduce((sum, gap) => sum + (gap.financial_impact || 0), 0);
  const highSeverityCount = gaps.filter(g => g.severity === 'high').length;
  const mediumSeverityCount = gaps.filter(g => g.severity === 'medium').length;

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">${totalPotentialRevenue.toLocaleString()}</p>
                <p className="text-xs text-slate-600">Revenue Opportunity</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-100 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{highSeverityCount}</p>
                <p className="text-xs text-slate-600">High Priority Gaps</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-yellow-100 rounded-lg">
                <FileText className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{gaps.length}</p>
                <p className="text-xs text-slate-600">Total Gaps Identified</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gaps List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            Coding & Documentation Gaps
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gaps.length === 0 ? (
            <div className="text-center py-8">
              <TrendingUp className="h-12 w-12 text-green-600 mx-auto mb-3" />
              <p className="text-slate-600">No gaps identified - excellent work!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {gaps.slice(0, 20).map((gap, idx) => (
                <div key={idx} className="p-4 border-l-4 border-l-blue-600 bg-slate-50 rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-sm">{gap.patient_name}</h4>
                        <Badge className={getSeverityColor(gap.severity)}>
                          {gap.severity} priority
                        </Badge>
                        {gap.financial_impact > 0 && (
                          <Badge className="bg-green-100 text-green-800">
                            +${gap.financial_impact.toLocaleString()}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mb-2">{gap.area}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm mb-2">
                    <div>
                      <p className="text-xs text-slate-600">Current</p>
                      <p className="font-medium">{gap.current}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">Recommended</p>
                      <p className="font-medium text-blue-700">{gap.recommended}</p>
                    </div>
                  </div>

                  <p className="text-sm text-slate-700">{gap.rationale}</p>
                </div>
              ))}

              {gaps.length > 20 && (
                <p className="text-center text-sm text-slate-600 pt-4">
                  +{gaps.length - 20} more gaps identified
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}