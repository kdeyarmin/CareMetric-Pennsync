import { useState, useEffect } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BookOpen,
  Bell,
  RefreshCw,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  FileText,
  ChevronDown,
  ChevronUp,
  Sparkles
} from "lucide-react";
import { format } from "date-fns";

export default function PolicyGuidelineMonitor({ _nurseEmail, onTrainingRecommended }) {
  const ai = useAICall();
  const [updates, setUpdates] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [lastChecked, setLastChecked] = useState(null);

  useEffect(() => {
    // Load cached updates
    try {
      const cached = localStorage.getItem('policy_updates_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        setUpdates(parsed.updates);
        setLastChecked(new Date(parsed.lastChecked));
      }
    } catch {}
  }, []);

  const checkForUpdates = async () => {

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a healthcare regulatory compliance AI that monitors and summarizes recent changes to Medicare/Medicaid regulations, CMS guidelines, and home health/hospice compliance requirements.

Generate a realistic summary of current regulatory landscape and any recent updates a home health nurse should be aware of.

Include:
1. Recent CMS guideline changes affecting home health documentation
2. Medicare CoP (Conditions of Participation) updates
3. OASIS assessment changes
4. Hospice quality reporting requirements
5. Documentation best practices updates
6. Infection control and safety guidelines

For each update, provide:
- The regulatory change or reminder
- Effective date
- Impact on nursing practice
- Required training or competency
- Priority level

Return JSON:
{
  "last_major_update": "YYYY-MM-DD",
  "regulatory_updates": [
    {
      "id": "unique_id",
      "title": "update title",
      "source": "CMS/Medicare/State/Agency",
      "effective_date": "YYYY-MM-DD",
      "category": "documentation" | "oasis" | "safety" | "billing" | "quality",
      "summary": "brief summary",
      "impact": "how it affects nursing practice",
      "action_required": "what nurses need to do",
      "training_needed": true/false,
      "training_topic": "topic if training needed",
      "priority": "critical" | "high" | "medium" | "low"
    }
  ],
  "compliance_reminders": [
    {
      "title": "reminder",
      "description": "details",
      "deadline": "if applicable"
    }
  ],
  "best_practice_tips": [
    "tip 1",
    "tip 2"
  ],
  "upcoming_changes": [
    {
      "title": "upcoming change",
      "expected_date": "when",
      "description": "what to expect"
    }
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            last_major_update: { type: "string" },
            regulatory_updates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  source: { type: "string" },
                  effective_date: { type: "string" },
                  category: { type: "string" },
                  summary: { type: "string" },
                  impact: { type: "string" },
                  action_required: { type: "string" },
                  training_needed: { type: "boolean" },
                  training_topic: { type: "string" },
                  priority: { type: "string" }
                }
              }
            },
            compliance_reminders: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                  deadline: { type: "string" }
                }
              }
            },
            best_practice_tips: { type: "array", items: { type: "string" } },
            upcoming_changes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  expected_date: { type: "string" },
                  description: { type: "string" }
                }
              }
            }
          }
        },
        add_context_from_internet: true
      });

      setUpdates(result);
      setLastChecked(new Date());

      // Cache the results
      try { localStorage.setItem('policy_updates_cache', JSON.stringify({
        updates: result,
        lastChecked: new Date().toISOString()
      })); } catch {}

      // Trigger training recommendations for updates that need it
      const trainingNeeded = result.regulatory_updates?.filter(u => u.training_needed);
      if (trainingNeeded?.length > 0 && onTrainingRecommended) {
        onTrainingRecommended(trainingNeeded.map(t => t.training_topic));
      }

    } catch (error) {
      console.error("Error checking for updates:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'documentation': return <FileText className="w-4 h-4" />;
      case 'oasis': return <BookOpen className="w-4 h-4" />;
      case 'safety': return <AlertTriangle className="w-4 h-4" />;
      case 'quality': return <CheckCircle2 className="w-4 h-4" />;
      default: return <Bell className="w-4 h-4" />;
    }
  };

  return (
    <Card className="border-indigo-200">
      <CardHeader 
        className="py-3 bg-gradient-to-r from-indigo-50 to-navy-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            Policy & Guideline Updates
          </CardTitle>
          <div className="flex items-center gap-2">
            {updates?.regulatory_updates?.some(u => u.priority === 'critical') && (
              <Badge className="bg-red-500 text-white animate-pulse">
                New Updates
              </Badge>
            )}
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 space-y-4">
          {/* Last Checked */}
          {lastChecked && (
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Last checked: {format(lastChecked, 'MMM d, yyyy h:mm a')}
            </p>
          )}

          {!updates ? (
            <div className="text-center py-4">
              <Bell className="w-12 h-12 mx-auto mb-3 text-indigo-300" />
              <p className="text-sm text-slate-600 mb-3">
                Stay updated on Medicare/CMS guideline changes
              </p>
              <Button
                onClick={checkForUpdates}
                disabled={ai.loading}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {ai.loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Checking Updates...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Check for Updates
                  </>
                )}
              </Button>
            </div>
          ) : (
            <>
              {/* Regulatory Updates */}
              {updates.regulatory_updates?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700">Recent Regulatory Updates:</p>
                  {updates.regulatory_updates.slice(0, 5).map((update) => (
                    <div 
                      key={update.id}
                      className={`p-3 rounded-lg border ${
                        update.priority === 'critical' ? 'bg-red-50 border-red-200' :
                        update.priority === 'high' ? 'bg-orange-50 border-orange-200' :
                        'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          {getCategoryIcon(update.category)}
                          <div>
                            <p className="font-medium text-sm">{update.title}</p>
                            <p className="text-xs text-slate-500">{update.source} • Effective: {update.effective_date}</p>
                          </div>
                        </div>
                        <Badge className={getPriorityColor(update.priority)}>
                          {update.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-700 mt-2">{update.summary}</p>
                      <p className="text-xs text-indigo-700 mt-1">
                        <strong>Action:</strong> {update.action_required}
                      </p>
                      {update.training_needed && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 text-xs gap-1"
                          onClick={() => onTrainingRecommended && onTrainingRecommended([update.training_topic])}
                        >
                          <GraduationCap className="w-3 h-3" />
                          Start Training: {update.training_topic}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Compliance Reminders */}
              {updates.compliance_reminders?.length > 0 && (
                <Alert className="bg-yellow-50 border-yellow-200">
                  <Bell className="w-4 h-4 text-yellow-600" />
                  <AlertDescription className="text-yellow-900">
                    <p className="font-semibold text-sm mb-1">Compliance Reminders:</p>
                    <ul className="text-xs space-y-1">
                      {updates.compliance_reminders.map((reminder, idx) => (
                        <li key={idx}>
                          <strong>{reminder.title}:</strong> {reminder.description}
                          {reminder.deadline && <span className="text-yellow-700"> (Due: {reminder.deadline})</span>}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {/* Best Practice Tips */}
              {updates.best_practice_tips?.length > 0 && (
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-green-800 mb-1">💡 Best Practice Tips:</p>
                  <ul className="text-xs text-green-700 space-y-1">
                    {updates.best_practice_tips.map((tip, idx) => (
                      <li key={idx}>• {tip}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Upcoming Changes */}
              {updates.upcoming_changes?.length > 0 && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-blue-800 mb-1">📅 Upcoming Changes:</p>
                  <ul className="text-xs text-blue-700 space-y-1">
                    {updates.upcoming_changes.map((change, idx) => (
                      <li key={idx}>
                        <strong>{change.title}</strong> ({change.expected_date}): {change.description}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Refresh Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={checkForUpdates}
                disabled={ai.loading}
                className="w-full"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${ai.loading ? 'animate-spin' : ''}`} />
                Refresh Updates
              </Button>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}