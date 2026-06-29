import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Calendar
} from "lucide-react";
import { format, parseISO, startOfWeek, subWeeks } from "date-fns";
import { categorizeIssue } from "./AuditCategoryAnalyzer";

export default function NurseAuditTrends({ audits = [], nurseEmail }) {
  // Filter audits for specific nurse if provided
  const filteredAudits = useMemo(() => {
    if (nurseEmail) {
      return audits.filter(a => a.nurse_email === nurseEmail);
    }
    return audits;
  }, [audits, nurseEmail]);

  // Calculate weekly trends
  const weeklyTrends = useMemo(() => {
    const weeks = {};
    const now = new Date();

    // Initialize last 8 weeks
    for (let i = 7; i >= 0; i--) {
      const weekStart = startOfWeek(subWeeks(now, i));
      const weekKey = format(weekStart, 'MM/dd');
      weeks[weekKey] = {
        week: weekKey,
        avgScore: 0,
        auditCount: 0,
        totalScore: 0,
        passCount: 0,
        failCount: 0,
        issueCount: 0
      };
    }

    filteredAudits.forEach(audit => {
      if (!audit.audit_date) return;
      const auditDate = parseISO(audit.audit_date);
      const weekStart = startOfWeek(auditDate);
      const weekKey = format(weekStart, 'MM/dd');

      if (weeks[weekKey]) {
        weeks[weekKey].auditCount++;
        weeks[weekKey].totalScore += audit.compliance_score || 0;
        weeks[weekKey].issueCount += audit.issues?.length || 0;
        if (audit.status === 'passed') weeks[weekKey].passCount++;
        else weeks[weekKey].failCount++;
      }
    });

    return Object.values(weeks).map(w => ({
      ...w,
      avgScore: w.auditCount > 0 ? Math.round(w.totalScore / w.auditCount) : null,
      passRate: w.auditCount > 0 ? Math.round((w.passCount / w.auditCount) * 100) : null
    }));
  }, [filteredAudits]);

  // Calculate category trends over time
  const categoryTrends = useMemo(() => {
    const categories = {};
    
    filteredAudits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const cat = categorizeIssue(issue.element || issue.problem || '');
        if (!categories[cat]) {
          categories[cat] = { name: cat, total: 0, recent: 0 };
        }
        categories[cat].total++;
        
        // Check if recent (last 2 weeks)
        if (audit.audit_date) {
          const auditDate = parseISO(audit.audit_date);
          const twoWeeksAgo = subWeeks(new Date(), 2);
          if (auditDate >= twoWeeksAgo) {
            categories[cat].recent++;
          }
        }
      });
    });

    return Object.values(categories)
      .map(cat => ({
        ...cat,
        trend: cat.recent > (cat.total - cat.recent) / 2 ? 'increasing' : 
               cat.recent < (cat.total - cat.recent) / 4 ? 'decreasing' : 'stable'
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredAudits]);

  // Calculate overall stats
  const overallStats = useMemo(() => {
    if (filteredAudits.length === 0) return null;

    const scores = filteredAudits.map(a => a.compliance_score || 0);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const passRate = Math.round(
      (filteredAudits.filter(a => a.status === 'passed').length / filteredAudits.length) * 100
    );

    // Calculate trend (compare last 10 vs previous 10)
    const recent = filteredAudits.slice(0, 10);
    const previous = filteredAudits.slice(10, 20);
    
    const recentAvg = recent.length > 0 
      ? recent.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recent.length 
      : 0;
    const previousAvg = previous.length > 0 
      ? previous.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / previous.length 
      : recentAvg;

    const trend = recentAvg > previousAvg + 5 ? 'improving' :
                  recentAvg < previousAvg - 5 ? 'declining' : 'stable';

    return { avgScore, passRate, trend, totalAudits: filteredAudits.length };
  }, [filteredAudits]);

  if (filteredAudits.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-slate-500">
          No audit history available for trend analysis.
        </CardContent>
      </Card>
    );
  }

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'improving':
      case 'decreasing':
        return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'declining':
      case 'increasing':
        return <TrendingDown className="w-4 h-4 text-red-600" />;
      default:
        return <Minus className="w-4 h-4 text-slate-600" />;
    }
  };

  const getTrendColor = (trend) => {
    switch (trend) {
      case 'improving':
      case 'decreasing':
        return 'text-green-600';
      case 'declining':
      case 'increasing':
        return 'text-red-600';
      default:
        return 'text-slate-600';
    }
  };

  return (
    <div className="space-y-4">
      {/* Overall Stats */}
      {overallStats && (
        <div className="grid grid-cols-4 gap-3">
          <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{overallStats.avgScore}%</p>
              <p className="text-xs text-blue-100">Avg Score</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{overallStats.passRate}%</p>
              <p className="text-xs text-green-100">Pass Rate</p>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-navy-500 to-navy-600 text-white">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{overallStats.totalAudits}</p>
              <p className="text-xs text-navy-100">Total Audits</p>
            </CardContent>
          </Card>
          <Card className={`bg-gradient-to-br ${
            overallStats.trend === 'improving' ? 'from-emerald-500 to-emerald-600' :
            overallStats.trend === 'declining' ? 'from-red-500 to-red-600' :
            'from-slate-500 to-slate-600'
          } text-white`}>
            <CardContent className="p-3 text-center">
              <div className="flex items-center justify-center gap-1">
                {getTrendIcon(overallStats.trend)}
                <p className="text-lg font-bold capitalize">{overallStats.trend}</p>
              </div>
              <p className="text-xs text-white/80">Trend</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Score Trend Chart */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-600" />
            Compliance Score Trend (Last 8 Weeks)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="avgScore" 
                  stroke="#3557b0" 
                  strokeWidth={2}
                  dot={{ fill: '#3557b0' }}
                  name="Avg Score"
                  connectNulls
                />
                <Line 
                  type="monotone" 
                  dataKey="passRate" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  dot={{ fill: '#10b981' }}
                  name="Pass Rate"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Category Trends */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-600" />
            Issue Category Trends
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-2">
            {categoryTrends.slice(0, 6).map((cat, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{cat.name}</span>
                  <Badge variant="outline" className="text-[10px]">{cat.total} total</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-[10px] ${
                    cat.trend === 'decreasing' ? 'bg-green-100 text-green-800' :
                    cat.trend === 'increasing' ? 'bg-red-100 text-red-800' :
                    'bg-slate-100 text-slate-800'
                  }`}>
                    {cat.recent} recent
                  </Badge>
                  <span className={`text-xs flex items-center gap-1 ${getTrendColor(cat.trend)}`}>
                    {getTrendIcon(cat.trend)}
                    {cat.trend}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}