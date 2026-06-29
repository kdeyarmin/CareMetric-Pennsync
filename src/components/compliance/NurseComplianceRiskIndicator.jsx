import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  BookOpen,
  ShieldAlert
} from "lucide-react";

export default function NurseComplianceRiskIndicator({ users = [] }) {
  const { data: audits = [] } = useQuery({
    queryKey: ['complianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 500),
  });

  const { data: recommendations = [] } = useQuery({
    queryKey: ['allRecommendations'],
    queryFn: () => base44.entities.TrainingRecommendation.list('-created_date', 500),
  });

  // Aggregate data by nurse
  const nurseRisk = {};
  
  audits.forEach(audit => {
    if (!nurseRisk[audit.nurse_email]) {
      nurseRisk[audit.nurse_email] = {
        email: audit.nurse_email,
        auditCount: 0,
        totalScore: 0,
        flaggedCount: 0,
        criticalCount: 0,
        issueTypes: {},
        recentScores: []
      };
    }
    const nurse = nurseRisk[audit.nurse_email];
    nurse.auditCount++;
    nurse.totalScore += audit.compliance_score || 0;
    if (audit.status === 'flagged') nurse.flaggedCount++;
    if (audit.status === 'critical') nurse.criticalCount++;
    nurse.recentScores.push(audit.compliance_score || 0);
    
    audit.issues?.forEach(issue => {
      nurse.issueTypes[issue.element] = (nurse.issueTypes[issue.element] || 0) + 1;
    });
  });

  // Add recommendation data
  recommendations.forEach(rec => {
    if (nurseRisk[rec.nurse_email]) {
      nurseRisk[rec.nurse_email].hasRecommendations = true;
    }
  });

  // Calculate risk scores and sort
  const nursesAtRisk = Object.values(nurseRisk)
    .map(nurse => {
      const avgScore = nurse.auditCount > 0 ? Math.round(nurse.totalScore / nurse.auditCount) : 100;
      const failRate = nurse.auditCount > 0 ? ((nurse.flaggedCount + nurse.criticalCount) / nurse.auditCount) * 100 : 0;
      const topIssues = Object.entries(nurse.issueTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([issue]) => issue);
      
      // Calculate trend. recentScores[0] is the NEWEST audit (query orders by
      // '-audit_date'), so the newest 5 are slice(0,5) and the rest are older.
      // The previous slice(-5)/slice(0,-5) had these reversed, inverting the
      // trend sign and showing improving nurses with a declining arrow.
      const recent = nurse.recentScores.slice(0, 5);
      const older = nurse.recentScores.slice(5);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.length > 0
        ? older.reduce((a, b) => a + b, 0) / older.length
        : recentAvg;
      const trend = recentAvg - olderAvg;

      // Risk score: lower avg score + higher fail rate + critical issues = higher risk
      const riskScore = Math.round(
        (100 - avgScore) * 0.5 + 
        failRate * 0.3 + 
        nurse.criticalCount * 10
      );

      const user = users.find(u => u.email === nurse.email);

      return {
        ...nurse,
        name: user?.full_name || nurse.email.split('@')[0],
        avgScore,
        failRate: Math.round(failRate),
        topIssues,
        trend,
        riskScore,
        riskLevel: riskScore > 40 ? 'high' : riskScore > 20 ? 'medium' : 'low'
      };
    })
    .filter(n => n.auditCount >= 2 && n.riskScore > 15)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5);

  if (nursesAtRisk.length === 0) {
    return null;
  }

  const getRiskColor = (level) => {
    switch (level) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  return (
    <Card className="border-2 border-orange-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <ShieldAlert className="w-5 h-5 text-orange-600" />
          <h3 className="font-semibold text-orange-900">Nurses Requiring Compliance Review</h3>
        </div>

        <div className="space-y-3">
          {nursesAtRisk.map(nurse => (
            <div key={nurse.email} className={`p-3 rounded-lg border ${getRiskColor(nurse.riskLevel)}`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-medium text-sm">{nurse.name}</p>
                  <p className="text-xs opacity-75">{nurse.auditCount} audits • {nurse.failRate}% fail rate</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <span className={`text-lg font-bold ${nurse.avgScore >= 70 ? 'text-green-600' : 'text-red-600'}`}>
                      {nurse.avgScore}%
                    </span>
                    {nurse.trend < -5 && <TrendingDown className="w-4 h-4 text-red-500" />}
                    {nurse.trend > 5 && <TrendingUp className="w-4 h-4 text-green-500" />}
                  </div>
                  <Badge variant="outline" className="text-xs capitalize">{nurse.riskLevel} risk</Badge>
                </div>
              </div>
              
              {nurse.topIssues.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="text-xs opacity-75">Common issues:</span>
                  {nurse.topIssues.map((issue, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {issue}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 mt-2 text-xs">
                <AlertTriangle className="w-3 h-3" />
                <span>{nurse.criticalCount} critical • {nurse.flaggedCount} flagged</span>
                {nurse.hasRecommendations && (
                  <Badge className="bg-indigo-100 text-indigo-800 text-xs">
                    <BookOpen className="w-3 h-3 mr-1" />
                    Has training recommendations
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}