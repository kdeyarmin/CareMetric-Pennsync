import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Zap,
  AlertTriangle,
  DollarSign,
  Shield,
  CheckCircle2,
  ArrowRight,
  Star,
  Target,
  TrendingUp
} from "lucide-react";

export default function KeyTakeawaysSummary({ analysisResults, revenueData }) {
  if (!analysisResults) return null;

  // Generate key takeaways
  const generateTakeaways = () => {
    const takeaways = {
      critical: [],
      revenue: [],
      quality: [],
      strengths: []
    };

    // Critical issues (highest priority)
    const highSeverityIssues = [
      ...(analysisResults.accuracy_issues || []).filter(i => i.severity === 'high'),
      ...(analysisResults.compliance_concerns || []).filter(c => c.severity === 'high')
    ];

    if (highSeverityIssues.length > 0) {
      takeaways.critical.push({
        icon: AlertTriangle,
        text: `${highSeverityIssues.length} high-priority issue${highSeverityIssues.length > 1 ? 's' : ''} require${highSeverityIssues.length === 1 ? 's' : ''} immediate attention`,
        detail: highSeverityIssues.slice(0, 2).map(i => i.issue || i.area).join('; '),
        type: 'warning'
      });
    }

    // Validation critical issues
    const criticalValidation = (analysisResults.validation_summary?.issues || [])
      .filter(i => i.severity === 'critical');
    if (criticalValidation.length > 0) {
      takeaways.critical.push({
        icon: Shield,
        text: 'Data validation errors detected',
        detail: 'Internal consistency issues may affect PDGM grouping accuracy',
        type: 'error'
      });
    }

    // Revenue opportunities
    const revenueTips = analysisResults.revenue_tips || [];
    const highImpactTips = revenueTips.filter(t => t.potential_impact === 'high');
    
    if (highImpactTips.length > 0) {
      takeaways.revenue.push({
        icon: DollarSign,
        text: `${highImpactTips.length} high-impact revenue optimization${highImpactTips.length > 1 ? 's' : ''} available`,
        detail: highImpactTips[0]?.category + ': ' + (highImpactTips[0]?.opportunity?.substring(0, 60) || '') + '...',
        type: 'success'
      });
    }

    if (revenueData?.revenueDifference > 0) {
      takeaways.revenue.push({
        icon: TrendingUp,
        text: `Potential revenue increase: $${revenueData.revenueDifference.toFixed(0)} per episode`,
        detail: `${revenueData.percentageIncrease}% improvement with recommended changes`,
        type: 'success'
      });
    }

    // Quality insights
    if (analysisResults.accuracy_score < 70) {
      takeaways.quality.push({
        icon: Target,
        text: `Accuracy score ${analysisResults.accuracy_score}% needs improvement`,
        detail: 'Review functional scoring and diagnosis documentation',
        type: 'warning'
      });
    } else if (analysisResults.accuracy_score >= 90) {
      takeaways.strengths.push({
        icon: CheckCircle2,
        text: `Excellent accuracy score: ${analysisResults.accuracy_score}%`,
        detail: 'Documentation demonstrates strong clinical specificity',
        type: 'success'
      });
    }

    if (analysisResults.compliance_score < 70) {
      takeaways.quality.push({
        icon: Shield,
        text: `Compliance score ${analysisResults.compliance_score}% indicates risk`,
        detail: 'Address regulatory concerns before submission',
        type: 'warning'
      });
    } else if (analysisResults.compliance_score >= 90) {
      takeaways.strengths.push({
        icon: Shield,
        text: `Strong compliance: ${analysisResults.compliance_score}%`,
        detail: 'Documentation meets CMS regulatory requirements',
        type: 'success'
      });
    }

    // Add strengths from analysis
    const strengths = analysisResults.strengths || [];
    if (strengths.length > 0) {
      takeaways.strengths.push({
        icon: Star,
        text: 'Documentation strengths identified',
        detail: strengths.slice(0, 2).join('; '),
        type: 'success'
      });
    }

    return takeaways;
  };

  const takeaways = generateTakeaways();
  const allTakeaways = [
    ...takeaways.critical,
    ...takeaways.revenue,
    ...takeaways.quality,
    ...takeaways.strengths
  ];

  const getTypeStyles = (type) => {
    switch (type) {
      case 'error': return { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-600', text: 'text-red-800' };
      case 'warning': return { bg: 'bg-yellow-50', border: 'border-yellow-200', icon: 'text-yellow-600', text: 'text-yellow-800' };
      case 'success': return { bg: 'bg-green-50', border: 'border-green-200', icon: 'text-green-600', text: 'text-green-800' };
      default: return { bg: 'bg-slate-50', border: 'border-slate-200', icon: 'text-slate-600', text: 'text-slate-800' };
    }
  };

  // Top recommendations
  const topRecommendations = analysisResults.key_recommendations?.slice(0, 3) || [];

  return (
    <Card className="border-2 border-indigo-300 shadow-lg">
      <CardHeader className="pb-3 bg-gradient-to-r from-indigo-100 to-navy-100">
        <CardTitle className="text-lg flex items-center gap-2">
          <Zap className="w-5 h-5 text-indigo-600" />
          Key Takeaways
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Score Summary */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center p-2 bg-slate-50 rounded-lg">
            <p className="text-2xl font-bold text-slate-800">{analysisResults.overall_score}%</p>
            <p className="text-xs text-slate-500">Overall</p>
          </div>
          <div className="text-center p-2 bg-blue-50 rounded-lg">
            <p className="text-2xl font-bold text-blue-700">{analysisResults.accuracy_score}%</p>
            <p className="text-xs text-blue-600">Accuracy</p>
          </div>
          <div className="text-center p-2 bg-navy-50 rounded-lg">
            <p className="text-2xl font-bold text-navy-700">{analysisResults.compliance_score}%</p>
            <p className="text-xs text-navy-600">Compliance</p>
          </div>
          <div className="text-center p-2 bg-green-50 rounded-lg">
            <p className="text-2xl font-bold text-green-700">{analysisResults.revenue_optimization_score}%</p>
            <p className="text-xs text-green-600">Revenue</p>
          </div>
        </div>

        {/* Key Insights */}
        <div className="space-y-2">
          {allTakeaways.slice(0, 5).map((takeaway, idx) => {
            const styles = getTypeStyles(takeaway.type);
            const Icon = takeaway.icon;
            
            return (
              <div 
                key={idx} 
                className={`p-3 rounded-lg border ${styles.bg} ${styles.border}`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 ${styles.icon} flex-shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${styles.text}`}>{takeaway.text}</p>
                    {takeaway.detail && (
                      <p className="text-xs text-slate-600 mt-1">{takeaway.detail}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Priority Actions */}
        {topRecommendations.length > 0 && (
          <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-3 rounded-lg border border-indigo-200">
            <p className="text-sm font-semibold text-indigo-800 mb-2 flex items-center gap-2">
              <ArrowRight className="w-4 h-4" />
              Priority Actions
            </p>
            <ol className="space-y-1">
              {topRecommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs text-indigo-700">
                  <span className="bg-indigo-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span>{rec}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Quick Summary Line */}
        <div className="text-center pt-2 border-t">
          <p className="text-xs text-slate-500">
            {takeaways.critical.length > 0 
              ? `⚠️ ${takeaways.critical.length} critical issue${takeaways.critical.length > 1 ? 's' : ''} • `
              : '✓ No critical issues • '}
            {takeaways.revenue.length > 0 
              ? `💰 Revenue optimization available • `
              : ''}
            {takeaways.strengths.length > 0 
              ? `⭐ ${takeaways.strengths.length} strength${takeaways.strengths.length > 1 ? 's' : ''} noted`
              : ''}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}