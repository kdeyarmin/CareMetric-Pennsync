import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import AgencyWideMetrics from "./AgencyWideMetrics";
import ComplianceTrendChart from "./ComplianceTrendChart";
import ProductivityBenchmarks from "./ProductivityBenchmarks";
import CommonIssuesAnalysis from "./CommonIssuesAnalysis";
import TrainingNeedsMatrix from "./TrainingNeedsMatrix";

export default function AgencyAnalyticsDashboard({ providers }) {
  // Fetch all compliance data
  const { data: allAudits = [] } = useQuery({
    queryKey: ['allAudits'],
    queryFn: async () => {
      const audits = await base44.entities.ComplianceAudit.list('-audit_date', 1000);
      return audits;
    }
  });

  const { data: allNotes = [] } = useQuery({
    queryKey: ['allNotes'],
    queryFn: async () => {
      const notes = await base44.entities.NoteConversion.list('-created_date', 1000);
      return notes;
    }
  });

  const { data: allTraining = [] } = useQuery({
    queryKey: ['allTraining'],
    queryFn: async () => {
      const training = await base44.entities.TrainingCompletion.list('-completion_date', 1000);
      return training;
    }
  });

  // Calculate agency-wide metrics with trends
  const metrics = useMemo(() => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    
    // Current month data
    const currentAudits = allAudits.filter(a => new Date(a.audit_date) >= lastMonth);
    const currentNotes = allNotes.filter(n => new Date(n.created_date) >= lastMonth);
    const currentTraining = allTraining.filter(t => t.status === 'completed' && new Date(t.completion_date) >= lastMonth);
    
    // Previous month data
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const prevAudits = allAudits.filter(a => {
      const date = new Date(a.audit_date);
      return date >= twoMonthsAgo && date < lastMonth;
    });
    const prevNotes = allNotes.filter(n => {
      const date = new Date(n.created_date);
      return date >= twoMonthsAgo && date < lastMonth;
    });
    
    const avgCompliance = currentAudits.length > 0
      ? currentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / currentAudits.length
      : 0;
    const prevAvgCompliance = prevAudits.length > 0
      ? prevAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / prevAudits.length
      : avgCompliance;

    const avgQuality = currentNotes.length > 0
      ? currentNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / currentNotes.length
      : 0;
    const prevAvgQuality = prevNotes.length > 0
      ? prevNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / prevNotes.length
      : avgQuality;

    const completedTraining = allTraining.filter(t => t.status === 'completed').length;
    const totalAssigned = allTraining.length;
    const trainingRate = totalAssigned > 0 ? Math.round((completedTraining / totalAssigned) * 100) : 0;

    return {
      avgCompliance: Math.round(avgCompliance),
      avgQuality: Math.round(avgQuality),
      totalNotes: currentNotes.length,
      trainingRate,
      complianceChange: Math.round(avgCompliance - prevAvgCompliance),
      qualityChange: Math.round(avgQuality - prevAvgQuality),
      productivityChange: prevNotes.length > 0 ? Math.round(((currentNotes.length - prevNotes.length) / prevNotes.length) * 100) : 0,
      trainingChange: null
    };
  }, [allAudits, allNotes, allTraining]);

  // Provider comparison data
  const providerComparison = useMemo(() => {
    return providers.slice(0, 10).map(p => {
      const providerAudits = allAudits.filter(a => a.nurse_email === p.email);
      const avgScore = providerAudits.length > 0
        ? providerAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / providerAudits.length
        : 0;
      
      return {
        name: p.full_name?.split(' ')[0] || p.email.split('@')[0],
        score: Math.round(avgScore)
      };
    }).sort((a, b) => b.score - a.score);
  }, [providers, allAudits]);

  // Trend over time - by month
  const trendData = useMemo(() => {
    const grouped = {};
    allAudits.forEach(audit => {
      const date = new Date(audit.audit_date);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[month]) {
        grouped[month] = { month, complianceScores: [], qualityScores: [] };
      }
      grouped[month].complianceScores.push(audit.compliance_score || 0);
    });

    allNotes.forEach(note => {
      const date = new Date(note.created_date);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[month]) {
        grouped[month] = { month, complianceScores: [], qualityScores: [] };
      }
      if (!grouped[month].qualityScores) grouped[month].qualityScores = [];
      grouped[month].qualityScores.push(note.quality_score || 0);
    });

    return Object.values(grouped)
      .map(g => ({
        month: g.month,
        compliance: g.complianceScores.length > 0 ? Math.round(g.complianceScores.reduce((a, b) => a + b, 0) / g.complianceScores.length) : 0,
        quality: g.qualityScores.length > 0 ? Math.round(g.qualityScores.reduce((a, b) => a + b, 0) / g.qualityScores.length) : 0
      }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-6);
  }, [allAudits, allNotes]);

  // Productivity benchmarks
  const productivityData = useMemo(() => {
    const avgNotes = allNotes.length / Math.max(providers.length, 1);
    
    return providers.slice(0, 10).map(p => {
      const providerNotes = allNotes.filter(n => n.nurse_email === p.email).length;
      return {
        name: p.full_name?.split(' ')[0] || p.email.split('@')[0],
        notes: providerNotes,
        avgNotes: Math.round(avgNotes)
      };
    }).sort((a, b) => b.notes - a.notes);
  }, [providers, allNotes]);

  // Common issues analysis
  const commonIssues = useMemo(() => {
    const issueMap = {};
    
    allAudits.forEach(audit => {
      if (audit.issues && Array.isArray(audit.issues)) {
        audit.issues.forEach(issue => {
          const key = issue.element || 'Unknown';
          if (!issueMap[key]) {
            issueMap[key] = {
              issue: key,
              description: issue.problem || issue.suggestion || '',
              count: 0,
              providers: new Set()
            };
          }
          issueMap[key].count++;
          if (audit.nurse_email) {
            issueMap[key].providers.add(audit.nurse_email);
          }
        });
      }
    });

    return Object.values(issueMap)
      .map(i => ({
        issue: i.issue,
        description: i.description,
        prevalence: Math.round((i.count / Math.max(allAudits.length, 1)) * 100),
        affectedProviders: i.providers.size,
        recommendation: getRecommendation(i.issue)
      }))
      .sort((a, b) => b.prevalence - a.prevalence)
      .slice(0, 5);
  }, [allAudits]);

  // Training needs
  const trainingNeeds = useMemo(() => {
    const needs = [];
    
    // Analyze common compliance issues
    if (metrics.avgCompliance < 85) {
      needs.push({
        topic: 'Medicare Compliance Documentation',
        reason: 'Agency average compliance below target (85%)',
        priority: 'high',
        providersNeeding: providers.length,
        expectedImpact: 15
      });
    }

    // Check for quality issues
    if (metrics.avgQuality < 85) {
      needs.push({
        topic: 'Clinical Documentation Quality',
        reason: 'Agency average quality score below target',
        priority: 'high',
        providersNeeding: Math.floor(providers.length * 0.7),
        expectedImpact: 12
      });
    }

    // Analyze specific issue patterns
    commonIssues.forEach(issue => {
      if (issue.prevalence > 50 && issue.affectedProviders > 2) {
        needs.push({
          topic: `Training: ${issue.issue}`,
          reason: `High prevalence (${issue.prevalence}%) across multiple providers`,
          priority: issue.prevalence > 70 ? 'high' : 'medium',
          providersNeeding: issue.affectedProviders,
          expectedImpact: 10
        });
      }
    });

    return needs.slice(0, 4);
  }, [metrics, commonIssues, providers.length]);

  function getRecommendation(issue) {
    const recommendations = {
      'HOMEBOUND STATUS': 'Provide homebound documentation training',
      'SKILLED NEED': 'Review skilled nursing criteria',
      'VITAL SIGNS': 'Standardize vital signs documentation',
      'MEDICATION RECONCILIATION': 'Med reconciliation training module',
      'ASSESSMENT': 'Comprehensive assessment training'
    };
    return recommendations[issue] || 'Targeted training recommended';
  }

  return (
    <div className="space-y-6">
      {/* High-level metrics */}
      <AgencyWideMetrics metrics={metrics} />

      {/* Compliance & Quality Trends */}
      <ComplianceTrendChart data={trendData} />

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Productivity Benchmarks */}
        <ProductivityBenchmarks data={productivityData} />

        {/* Common Issues */}
        <CommonIssuesAnalysis issues={commonIssues} />
      </div>

      {/* Training Needs */}
      <TrainingNeedsMatrix trainingNeeds={trainingNeeds} />
    </div>
  );
}