import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip
} from "recharts";
import {
  Home,
  Stethoscope,
  Activity,
  ClipboardList,
  MessageSquare,
  Pill,
  Target,
  User,
  FileText
} from "lucide-react";

const CATEGORY_CONFIG = {
  'Homebound Status': { icon: Home, color: '#3557b0' },
  'Skilled Need': { icon: Stethoscope, color: '#8b5cf6' },
  'Vital Signs': { icon: Activity, color: '#10b981' },
  'Assessment': { icon: ClipboardList, color: '#f59e0b' },
  'Patient Response': { icon: MessageSquare, color: '#0d9488' },
  'Medication': { icon: Pill, color: '#ef4444' },
  'Care Plan': { icon: Target, color: '#06b6d4' },
  'Functional Status': { icon: User, color: '#84cc16' },
  'General': { icon: FileText, color: '#6b7280' }
};

export default function AuditCategoryAnalyzer({ audits = [] }) {
  const categoryData = useMemo(() => {
    const categories = {};
    
    audits.forEach(audit => {
      audit.issues?.forEach(issue => {
        const category = categorizeIssue(issue.element || issue.problem || '');
        if (!categories[category]) {
          categories[category] = {
            name: category,
            count: 0,
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            issues: []
          };
        }
        categories[category].count++;
        // Only the four known severities are seeded; an unexpected value would make
        // categories[category][severity]++ do undefined++ === NaN. Clamp to 'medium'.
        const severity = ['critical', 'high', 'medium', 'low'].includes(issue.severity) ? issue.severity : 'medium';
        categories[category][severity]++;
        categories[category].issues.push({
          ...issue,
          auditDate: audit.audit_date,
          nurseEmail: audit.nurse_email
        });
      });
    });

    return Object.values(categories).sort((a, b) => b.count - a.count);
  }, [audits]);

  const pieChartData = useMemo(() => {
    return categoryData.map(cat => ({
      name: cat.name,
      value: cat.count,
      color: CATEGORY_CONFIG[cat.name]?.color || '#6b7280'
    }));
  }, [categoryData]);

  const totalIssues = categoryData.reduce((sum, cat) => sum + cat.count, 0);

  if (audits.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-slate-500">
          No audit data available for analysis.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-navy-50 py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-blue-600" />
          Issues by Documentation Category
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pie Chart */}
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value, name) => [`${value} issues`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Category List */}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {categoryData.map((cat, idx) => {
              const config = CATEGORY_CONFIG[cat.name] || CATEGORY_CONFIG['General'];
              const Icon = config.icon;
              const percentage = Math.round((cat.count / totalIssues) * 100);

              return (
                <div key={idx} className="p-2 bg-slate-50 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-6 h-6 rounded flex items-center justify-center"
                        style={{ backgroundColor: `${config.color}20` }}
                      >
                        <Icon className="w-3 h-3" style={{ color: config.color }} />
                      </div>
                      <span className="text-xs font-medium text-slate-900">{cat.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px]">
                        {cat.count} issues
                      </Badge>
                      <span className="text-[10px] text-slate-500">{percentage}%</span>
                    </div>
                  </div>
                  <Progress 
                    value={percentage} 
                    className="h-1.5"
                    style={{ '--progress-foreground': config.color }}
                  />
                  <div className="flex gap-1 mt-1">
                    {cat.critical > 0 && (
                      <Badge className="text-[9px] bg-red-100 text-red-800 px-1">{cat.critical} critical</Badge>
                    )}
                    {cat.high > 0 && (
                      <Badge className="text-[9px] bg-orange-100 text-orange-800 px-1">{cat.high} high</Badge>
                    )}
                    {cat.medium > 0 && (
                      <Badge className="text-[9px] bg-yellow-100 text-yellow-800 px-1">{cat.medium} med</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-lg font-bold text-slate-900">{totalIssues}</p>
            <p className="text-[10px] text-slate-500">Total Issues</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-red-600">
              {categoryData.reduce((sum, c) => sum + c.critical, 0)}
            </p>
            <p className="text-[10px] text-slate-500">Critical</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-orange-600">
              {categoryData.reduce((sum, c) => sum + c.high, 0)}
            </p>
            <p className="text-[10px] text-slate-500">High</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-600">{categoryData.length}</p>
            <p className="text-[10px] text-slate-500">Categories</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Helper function to categorize issues
function categorizeIssue(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes('homebound') || lower.includes('home bound') || lower.includes('taxing effort')) {
    return 'Homebound Status';
  }
  if (lower.includes('skilled') || lower.includes('skill') || lower.includes('nursing judgment')) {
    return 'Skilled Need';
  }
  if (lower.includes('vital') || lower.includes('bp') || lower.includes('blood pressure') || 
      lower.includes('heart rate') || lower.includes('temperature') || lower.includes('o2')) {
    return 'Vital Signs';
  }
  if (lower.includes('assessment') || lower.includes('finding') || lower.includes('exam')) {
    return 'Assessment';
  }
  if (lower.includes('response') || lower.includes('teach') || lower.includes('education') || 
      lower.includes('patient understood') || lower.includes('verbalized')) {
    return 'Patient Response';
  }
  if (lower.includes('medication') || lower.includes('med') || lower.includes('drug') || lower.includes('rx')) {
    return 'Medication';
  }
  if (lower.includes('care plan') || lower.includes('goal') || lower.includes('intervention')) {
    return 'Care Plan';
  }
  if (lower.includes('functional') || lower.includes('adl') || lower.includes('mobility') || lower.includes('ambulation')) {
    return 'Functional Status';
  }
  
  return 'General';
}

export { categorizeIssue };