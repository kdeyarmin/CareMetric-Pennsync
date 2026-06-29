import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Trophy,
  TrendingUp,
  DollarSign,
  Lightbulb,
  Star
} from "lucide-react";

export default function TopOptimizationOpportunities({ revenueTips }) {
  if (!revenueTips || revenueTips.length === 0) return null;

  // Sort by impact and get top 3
  const impactOrder = { high: 3, medium: 2, low: 1 };
  const sortedTips = [...revenueTips]
    .sort((a, b) => (impactOrder[b.potential_impact] || 0) - (impactOrder[a.potential_impact] || 0))
    .slice(0, 3);

  const getImpactColor = (impact) => {
    switch (impact) {
      case 'high': return 'bg-green-100 text-green-800 border-green-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getRankStyle = (index) => {
    switch (index) {
      case 0: return { bg: 'bg-gradient-to-r from-yellow-400 to-amber-500', icon: '🥇' };
      case 1: return { bg: 'bg-gradient-to-r from-slate-300 to-slate-400', icon: '🥈' };
      case 2: return { bg: 'bg-gradient-to-r from-amber-600 to-amber-700', icon: '🥉' };
      default: return { bg: 'bg-slate-200', icon: '' };
    }
  };

  return (
    <Card className="border-2 border-amber-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-amber-50 to-yellow-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-600" />
          Top 3 Optimization Opportunities
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {sortedTips.map((tip, index) => {
          const rankStyle = getRankStyle(index);
          
          return (
            <div
              key={index}
              className={`relative p-4 rounded-lg border-2 ${
                index === 0 ? 'border-amber-300 bg-amber-50' :
                index === 1 ? 'border-slate-300 bg-slate-50' :
                'border-orange-200 bg-orange-50'
              }`}
            >
              {/* Rank Badge */}
              <div className="absolute -top-2 -left-2">
                <span className="text-2xl">{rankStyle.icon}</span>
              </div>

              <div className="ml-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {tip.category}
                    </Badge>
                    <Badge className={`text-xs ${getImpactColor(tip.potential_impact)}`}>
                      <TrendingUp className="w-3 h-3 mr-1" />
                      {tip.potential_impact} impact
                    </Badge>
                  </div>
                  {tip.estimated_revenue_impact && (
                    <Badge className="bg-green-600 text-white text-xs">
                      <DollarSign className="w-3 h-3" />
                      {tip.estimated_revenue_impact}
                    </Badge>
                  )}
                </div>

                {/* Current vs Opportunity */}
                <div className="space-y-2">
                  {tip.current_documentation && (
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-slate-500 w-16 flex-shrink-0">Current:</span>
                      <p className="text-xs text-slate-600">{tip.current_documentation}</p>
                    </div>
                  )}
                  
                  {tip.opportunity && (
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-green-600 w-16 flex-shrink-0">Improve:</span>
                      <p className="text-xs text-green-700 font-medium">{tip.opportunity}</p>
                    </div>
                  )}
                </div>

                {/* Action */}
                {tip.specific_action && (
                  <div className="mt-3 p-2 bg-white rounded border flex items-start gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-medium text-slate-700">Recommended Action:</p>
                      <p className="text-xs text-slate-600">{tip.specific_action}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Summary */}
        <div className="mt-4 p-3 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-green-600" />
            <p className="text-sm font-medium text-green-800">
              Implementing these top opportunities could significantly improve your PDGM reimbursement
            </p>
          </div>
          <p className="text-xs text-green-600 mt-1 ml-6">
            Focus on high-impact items first for maximum revenue optimization
          </p>
        </div>
      </CardContent>
    </Card>
  );
}