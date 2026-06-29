import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from "recharts";
import {
  TrendingUp,
  AlertTriangle,
  BookOpen,
  Loader2,
  RefreshCw
} from "lucide-react";

export default function NurseFeedbackAggregator({ nurseEmail, onTrainingRecommendations }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aggregatedData, setAggregatedData] = useState(null);

  // Fetch compliance audits for this nurse
  const { data: audits = [] } = useQuery({
    queryKey: ['nurseAudits', nurseEmail],
    queryFn: () => base44.entities.ComplianceAudit.filter({ nurse_email: nurseEmail }, '-audit_date', 50),
    enabled: !!nurseEmail
  });

  // Fetch training recommendations
  const { data: recommendations = [] } = useQuery({
    queryKey: ['nurseRecommendations', nurseEmail],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ nurse_email: nurseEmail }, '-created_date', 100),
    enabled: !!nurseEmail
  });

  // Fetch note conversions for quality metrics
  const { data: noteConversions = [] } = useQuery({
    queryKey: ['nurseNoteConversions', nurseEmail],
    queryFn: () => base44.entities.NoteConversion.filter({ nurse_email: nurseEmail }, '-created_date', 50),
    enabled: !!nurseEmail
  });

  const categorizeIssue = useCallback((element) => {
    const elementLower = (element || '').toLowerCase();
    if (elementLower.includes('homebound')) return 'Homebound Status';
    if (elementLower.includes('skilled') || elementLower.includes('need')) return 'Skilled Need Justification';
    if (elementLower.includes('vital') || elementLower.includes('bp') || elementLower.includes('heart')) return 'Vital Signs Documentation';
    if (elementLower.includes('assessment') || elementLower.includes('finding')) return 'Assessment Documentation';
    if (elementLower.includes('response') || elementLower.includes('patient')) return 'Patient Response';
    if (elementLower.includes('plan') || elementLower.includes('goal')) return 'Care Planning';
    if (elementLower.includes('intervention')) return 'Interventions';
    if (elementLower.includes('functional') || elementLower.includes('adl')) return 'Functional Status';
    if (elementLower.includes('medication') || elementLower.includes('med')) return 'Medication Documentation';
    if (elementLower.includes('communication') || elementLower.includes('family')) return 'Communication';
    return 'General Documentation';
  }, []);

  const calculatePriority = useCallback((data) => {
    return (data.severity.critical * 4) + (data.severity.high * 3) + (data.severity.medium * 2) + (data.severity.low * 1) + data.count;
  }, []);

  const aggregateFeedback = useCallback(async () => {
    setIsAnalyzing(true);

    // Aggregate issues from compliance audits
    const issueCategories = {};
    const issueDetails = [];

    audits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const category = categorizeIssue(issue.element || issue.problem);
        if (!issueCategories[category]) {
          issueCategories[category] = { count: 0, severity: { critical: 0, high: 0, medium: 0, low: 0 } };
        }
        issueCategories[category].count++;
        issueCategories[category].severity[issue.severity || 'medium']++;
        issueDetails.push({ ...issue, category, date: audit.audit_date });
      });
    });

    // Aggregate recommendation types
    const recTypes = {};
    recommendations.forEach(rec => {
      const type = rec.recommendation_type || 'documentation';
      if (!recTypes[type]) recTypes[type] = { count: 0, addressed: 0 };
      recTypes[type].count++;
      if (rec.addressed) recTypes[type].addressed++;
    });

    // Calculate quality scores trend
    const qualityTrend = noteConversions.slice(0, 20).map(nc => ({
      date: nc.created_date?.split('T')[0],
      score: nc.quality_score || 0,
      compliance: nc.compliance_score || 0
    })).reverse();

    // Calculate average scores
    const avgQuality = noteConversions.length > 0
      ? Math.round(noteConversions.reduce((sum, nc) => sum + (nc.quality_score || 0), 0) / noteConversions.length)
      : 0;

    const avgCompliance = audits.length > 0
      ? Math.round(audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length)
      : 0;

    // Identify skill gaps
    const skillGaps = Object.entries(issueCategories)
      .map(([category, data]) => ({
        category,
        count: data.count,
        severity: data.severity,
        priority: calculatePriority(data)
      }))
      .sort((a, b) => b.priority - a.priority);

    const aggregated = {
      issueCategories,
      issueDetails,
      recTypes,
      qualityTrend,
      avgQuality,
      avgCompliance,
      skillGaps,
      totalAudits: audits.length,
      totalRecommendations: recommendations.length,
      passRate: audits.length > 0 
        ? Math.round((audits.filter(a => a.status === 'passed').length / audits.length) * 100)
        : 0
    };

    setAggregatedData(aggregated);
    onTrainingRecommendations?.(skillGaps);
    setIsAnalyzing(false);
  }, [audits, recommendations, noteConversions, onTrainingRecommendations, categorizeIssue, calculatePriority]);

  useEffect(() => {
    if (audits.length > 0 || recommendations.length > 0 || noteConversions.length > 0) {
      aggregateFeedback();
    }
  }, [audits, recommendations, noteConversions, aggregateFeedback]);

  const getSkillRadarData = () => {
    if (!aggregatedData) return [];
    const categories = [
      'Homebound Status', 'Skilled Need Justification', 'Vital Signs Documentation',
      'Assessment Documentation', 'Patient Response', 'Care Planning'
    ];
    
    return categories.map(cat => {
      const gap = aggregatedData.skillGaps.find(g => g.category === cat);
      const issueCount = gap?.count || 0;
      // Invert: higher score = better (fewer issues)
      const score = Math.max(0, 100 - (issueCount * 10));
      return { category: cat.split(' ')[0], score, fullName: cat };
    });
  };

  if (!nurseEmail) {
    return null;
  }

  return (
    <Card className="border-2 border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-600" />
            AI Feedback Analysis
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={aggregateFeedback}
            disabled={isAnalyzing}
            className="h-7 text-xs"
          >
            {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {isAnalyzing ? (
          <div className="text-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-2" />
            <p className="text-sm text-slate-600">Analyzing your documentation feedback...</p>
          </div>
        ) : aggregatedData ? (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 p-3 rounded-lg text-center">
                <p className="text-2xl font-bold text-blue-700">{aggregatedData.avgQuality}%</p>
                <p className="text-xs text-slate-600">Avg Quality</p>
              </div>
              <div className="bg-green-50 p-3 rounded-lg text-center">
                <p className="text-2xl font-bold text-green-700">{aggregatedData.avgCompliance}%</p>
                <p className="text-xs text-slate-600">Avg Compliance</p>
              </div>
              <div className="bg-navy-50 p-3 rounded-lg text-center">
                <p className="text-2xl font-bold text-navy-700">{aggregatedData.passRate}%</p>
                <p className="text-xs text-slate-600">Pass Rate</p>
              </div>
            </div>

            {/* Skill Gaps Radar */}
            {getSkillRadarData().length > 0 && (
              <div className="h-48">
                <p className="text-xs font-semibold text-slate-700 mb-2">Documentation Skill Profile</p>
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={getSkillRadarData()}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="category" tick={{ fontSize: 10 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8 }} />
                    <Radar name="Score" dataKey="score" stroke="#264491" fill="#264491" fillOpacity={0.5} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top Skill Gaps */}
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-orange-500" />
                Areas Needing Improvement
              </p>
              <div className="space-y-2">
                {aggregatedData.skillGaps.slice(0, 5).map((gap, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] ${
                        gap.priority > 10 ? 'bg-red-100 text-red-800' :
                        gap.priority > 5 ? 'bg-orange-100 text-orange-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {gap.count} issues
                      </Badge>
                      <span className="text-xs font-medium text-slate-700">{gap.category}</span>
                    </div>
                    <Button asChild size="sm" variant="ghost" className="h-6 text-xs text-indigo-600">
                      <Link to={createPageUrl('NurseTrainingHub')}>
                        <BookOpen className="w-3 h-3 mr-1" /> Train
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-slate-500 text-center py-4">
            No feedback data available yet. Complete some documentation to see your analysis.
          </p>
        )}
      </CardContent>
    </Card>
  );
}