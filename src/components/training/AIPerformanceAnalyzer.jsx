import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Brain, Loader2, Target, TrendingUp, BookOpen, CheckCircle2,
  ArrowRight, Zap, AlertTriangle, BarChart3, Shield, Sparkles,
  Clock, ChevronDown, ChevronUp
} from "lucide-react";
import { toast } from "sonner";

const SEVERITY_COLORS = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function AIPerformanceAnalyzer({ userEmail, skillGaps, completions, trainingModules }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [expandedSection, setExpandedSection] = useState(null);
  const queryClient = useQueryClient();

  // Fetch broad performance data
  const { data: violations = [] } = useQuery({
    queryKey: ["userViolations", userEmail],
    queryFn: () => base44.entities.ComplianceViolation.filter({ user_email: userEmail }, "-created_date", 100),
    enabled: !!userEmail, initialData: []
  });
  const { data: noteConversions = [] } = useQuery({
    queryKey: ["noteConversions", userEmail],
    queryFn: () => base44.entities.NoteConversion.filter({ nurse_email: userEmail }, "-created_date", 50),
    enabled: !!userEmail, initialData: []
  });
  const { data: timeSavings = [] } = useQuery({
    queryKey: ["timeSavings", userEmail],
    queryFn: () => base44.entities.TimeSavings.filter({ user_email: userEmail }, "-created_date", 50),
    enabled: !!userEmail, initialData: []
  });
  const { data: aiFeedback = [] } = useQuery({
    queryKey: ["aiFeedback", userEmail],
    queryFn: () => base44.entities.AIFeedback.filter({ user_email: userEmail }, "-created_date", 50),
    enabled: !!userEmail, initialData: []
  });

  const assignTrainingMutation = useMutation({
    mutationFn: (moduleId) =>
      base44.entities.TrainingCompletion.create({
        nurse_email: userEmail,
        training_module_id: moduleId,
        status: "assigned",
        due_date: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(["trainingCompletions", userEmail]);
      toast.success("Training assigned to your plan");
    },
  });

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const completedIds = completions.filter((c) => c.status === "completed").map((c) => c.training_module_id);
      const completedTitles = trainingModules.filter((m) => completedIds.includes(m.id)).map((m) => m.title);
      const availableModules = trainingModules.filter((m) => !completedIds.includes(m.id)).map((m) => ({
        id: m.id, title: m.title, category: m.category, difficulty: m.difficulty_level,
        duration: m.duration_minutes, skills: m.related_skills || [],
      }));

      // Aggregate performance metrics
      const avgQuality = noteConversions.length > 0
        ? Math.round(noteConversions.reduce((s, n) => s + (n.quality_score || 0), 0) / noteConversions.length)
        : null;
      const avgCompliance = noteConversions.length > 0
        ? Math.round(noteConversions.reduce((s, n) => s + (n.compliance_score || 0), 0) / noteConversions.length)
        : null;
      const avgImprovement = noteConversions.filter((n) => n.compliance_improvement != null).length > 0
        ? Math.round(noteConversions.filter((n) => n.compliance_improvement != null).reduce((s, n) => s + n.compliance_improvement, 0) / noteConversions.filter((n) => n.compliance_improvement != null).length)
        : null;
      const totalTimeSaved = timeSavings.reduce((s, t) => s + (t.time_saved_minutes || 0), 0);

      // Violation patterns
      const violationCategories = {};
      violations.forEach((v) => {
        const cat = v.rule_category || "General";
        violationCategories[cat] = (violationCategories[cat] || 0) + 1;
      });
      const topViolationCategories = Object.entries(violationCategories).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const openViolations = violations.filter((v) => v.status === "open" || v.status === "in_progress");
      const criticalViolations = violations.filter((v) => v.severity === "critical");

      // AI feedback patterns
      const rejectedSuggestions = aiFeedback.filter((f) => f.user_action === "rejected");
      const editedSuggestions = aiFeedback.filter((f) => f.user_action === "edited");

      const activeGaps = skillGaps.filter((g) => g.status === "identified" || g.status === "in_progress");

      const prompt = `You are an expert nursing education director analyzing individual performance data for a home health / hospice nurse. Provide deeply personalized training recommendations.

NURSE PERFORMANCE SUMMARY:
- Completed trainings: ${completedTitles.length} (${completedTitles.slice(0, 8).join(", ")})
- Notes enhanced: ${noteConversions.length}
- Average Quality Score: ${avgQuality ?? "N/A"}%
- Average Compliance Score: ${avgCompliance ?? "N/A"}%
- Average Compliance Improvement from AI: ${avgImprovement ?? "N/A"} pts
- Total time saved with AI: ${totalTimeSaved} minutes

COMPLIANCE VIOLATIONS (${violations.length} total, ${openViolations.length} open, ${criticalViolations.length} critical):
Top categories: ${topViolationCategories.map(([cat, count]) => `${cat}: ${count}`).join(", ") || "None"}
Recent violations: ${violations.slice(0, 8).map((v) => `${v.rule_name} (${v.severity})`).join("; ") || "None"}

SKILL GAPS (${activeGaps.length} active):
${activeGaps.map((g) => `- ${g.skill_area} [${g.gap_type}, ${g.severity}]: ${g.ai_reasoning}`).join("\n") || "None identified"}

AI USAGE PATTERNS:
- Rejected AI suggestions: ${rejectedSuggestions.length} (types: ${[...new Set(rejectedSuggestions.map((f) => f.ai_suggestion_type))].join(", ") || "none"})
- Edited AI suggestions: ${editedSuggestions.length}

AVAILABLE TRAINING MODULES:
${availableModules.slice(0, 20).map((m) => `- "${m.title}" [${m.category}, ${m.difficulty}] ${m.duration}min — skills: ${m.skills.join(", ")}`).join("\n")}

Based on this data, produce a comprehensive analysis as JSON:
{
  "overall_readiness_score": <number 0-100>,
  "risk_level": "low" | "moderate" | "high",
  "risk_summary": "<brief sentence>",
  "strengths": [{"area": "", "evidence": ""}],
  "weaknesses": [{"area": "", "evidence": "", "impact": ""}],
  "priority_training": [{"module_title": "", "module_id": "", "reason": "", "urgency": "critical|high|medium", "addresses": ""}],
  "learning_path": [{"step": 1, "focus": "", "modules": [""], "outcome": "", "estimated_weeks": 1}],
  "compliance_action_plan": [{"issue": "", "action": "", "training": ""}],
  "personalized_tips": [""]
}
Match module_id to the available modules list. Only recommend modules from the list. If no matching module exists, leave module_id empty.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_readiness_score: { type: "number" },
            risk_level: { type: "string" },
            risk_summary: { type: "string" },
            strengths: { type: "array", items: { type: "object" } },
            weaknesses: { type: "array", items: { type: "object" } },
            priority_training: { type: "array", items: { type: "object" } },
            learning_path: { type: "array", items: { type: "object" } },
            compliance_action_plan: { type: "array", items: { type: "object" } },
            personalized_tips: { type: "array", items: { type: "string" } },
          },
        },
      });

      setAnalysis(response);
      setExpandedSection("overview");
      toast.success("Performance analysis complete");
    } catch (error) {
      console.error("Error running analysis:", error);
      toast.error("Failed to analyze performance");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const isModuleAssigned = (moduleId) => completions.some((c) => c.training_module_id === moduleId && c.status !== "completed");

  const toggle = (section) => setExpandedSection(expandedSection === section ? null : section);

  // Quick stat cards from raw data
  const avgQuality = noteConversions.length > 0
    ? Math.round(noteConversions.reduce((s, n) => s + (n.quality_score || 0), 0) / noteConversions.length)
    : null;
  const avgCompliance = noteConversions.length > 0
    ? Math.round(noteConversions.reduce((s, n) => s + (n.compliance_score || 0), 0) / noteConversions.length)
    : null;
  const openViolations = violations.filter((v) => v.status === "open" || v.status === "in_progress").length;

  return (
    <div className="space-y-4">
      {/* Performance snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniStat label="Avg Quality" value={avgQuality != null ? `${avgQuality}%` : "—"} color="blue" />
        <MiniStat label="Avg Compliance" value={avgCompliance != null ? `${avgCompliance}%` : "—"} color="green" />
        <MiniStat label="Open Violations" value={openViolations} color={openViolations > 5 ? "red" : "amber"} />
        <MiniStat label="Active Skill Gaps" value={skillGaps.filter((g) => g.status === "identified" || g.status === "in_progress").length} color="purple" />
      </div>

      {/* CTA */}
      <Card className="bg-gradient-to-r from-indigo-50 via-blue-50 to-purple-50 border-indigo-200">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
            <div>
              <h3 className="font-bold text-indigo-900 flex items-center gap-2 text-sm sm:text-base">
                <Brain className="w-5 h-5" /> AI Performance Analyzer
              </h3>
              <p className="text-xs sm:text-sm text-indigo-700 mt-1">
                Analyzes your compliance scores, quality metrics, violations, and skill gaps to build a personalized training plan.
              </p>
            </div>
            <Button
              onClick={analysis ? () => { setAnalysis(null); runAnalysis(); } : runAnalysis}
              disabled={isAnalyzing}
              className="bg-indigo-600 hover:bg-indigo-700 w-full sm:w-auto flex-shrink-0"
            >
              {isAnalyzing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
              ) : analysis ? (
                <><Sparkles className="w-4 h-4 mr-2" /> Re-Analyze</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Analyze My Performance</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {analysis && (
        <>
          {/* Overview */}
          <SectionCard
            title="Performance Overview"
            icon={<BarChart3 className="w-5 h-5 text-blue-600" />}
            isOpen={expandedSection === "overview"}
            onToggle={() => toggle("overview")}
          >
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="relative w-24 h-24 flex-shrink-0">
                  <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="10" />
                    <circle cx="50" cy="50" r="42" fill="none"
                      stroke={analysis.overall_readiness_score >= 80 ? "#22c55e" : analysis.overall_readiness_score >= 60 ? "#f59e0b" : "#ef4444"}
                      strokeWidth="10" strokeLinecap="round"
                      strokeDasharray={`${(analysis.overall_readiness_score / 100) * 264} 264`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold">{analysis.overall_readiness_score}</span>
                  </div>
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <Badge className={analysis.risk_level === "high" ? "bg-red-100 text-red-800" : analysis.risk_level === "moderate" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}>
                    {analysis.risk_level} risk
                  </Badge>
                  <p className="text-sm text-slate-600 mt-2">{analysis.risk_summary}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                  <h4 className="text-xs font-semibold text-green-800 mb-2 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Strengths</h4>
                  {analysis.strengths?.map((s, i) => (
                    <div key={i} className="mb-2 last:mb-0">
                      <p className="text-sm font-medium text-green-900">{s.area}</p>
                      <p className="text-xs text-green-700">{s.evidence}</p>
                    </div>
                  ))}
                </div>
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <h4 className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Weaknesses</h4>
                  {analysis.weaknesses?.map((w, i) => (
                    <div key={i} className="mb-2 last:mb-0">
                      <p className="text-sm font-medium text-amber-900">{w.area}</p>
                      <p className="text-xs text-amber-700">{w.evidence}</p>
                      {w.impact && <p className="text-xs text-red-600 mt-0.5">Impact: {w.impact}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* Priority Training */}
          {analysis.priority_training?.length > 0 && (
            <SectionCard
              title={`Priority Training (${analysis.priority_training.length})`}
              icon={<Zap className="w-5 h-5 text-amber-600" />}
              isOpen={expandedSection === "priority"}
              onToggle={() => toggle("priority")}
            >
              <div className="space-y-2">
                {analysis.priority_training.map((rec, idx) => {
                  const assigned = rec.module_id && isModuleAssigned(rec.module_id);
                  return (
                    <div key={idx} className={`p-3 rounded-lg border ${SEVERITY_COLORS[rec.urgency] || SEVERITY_COLORS.medium}`}>
                      <div className="flex flex-col sm:flex-row items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{rec.module_title}</span>
                            <Badge variant="outline" className="text-[10px]">{rec.urgency}</Badge>
                          </div>
                          <p className="text-xs text-slate-600 mt-1">{rec.reason}</p>
                          {rec.addresses && <p className="text-xs text-slate-500 mt-0.5">Addresses: {rec.addresses}</p>}
                        </div>
                        {rec.module_id && (
                          <Button
                            size="sm"
                            variant={assigned ? "outline" : "default"}
                            disabled={assigned || assignTrainingMutation.isPending}
                            onClick={() => assignTrainingMutation.mutate(rec.module_id)}
                            className="flex-shrink-0"
                          >
                            {assigned ? "Assigned" : "Enroll"}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          {/* Learning Path */}
          {analysis.learning_path?.length > 0 && (
            <SectionCard
              title="Personalized Learning Path"
              icon={<ArrowRight className="w-5 h-5 text-indigo-600" />}
              isOpen={expandedSection === "path"}
              onToggle={() => toggle("path")}
            >
              <div className="relative pl-6 space-y-4">
                <div className="absolute left-2.5 top-1 bottom-1 w-0.5 bg-indigo-200" />
                {analysis.learning_path.map((step, idx) => (
                  <div key={idx} className="relative">
                    <div className="absolute -left-6 top-0 w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold">
                      {step.step || idx + 1}
                    </div>
                    <div className="pb-3 border-b border-slate-100 last:border-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-sm text-slate-900">{step.focus}</h4>
                        {step.estimated_weeks && (
                          <span className="text-[10px] text-slate-500 flex items-center gap-0.5"><Clock className="w-3 h-3" /> ~{step.estimated_weeks}w</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {step.modules?.map((mod, mi) => (
                          <Badge key={mi} variant="outline" className="text-[10px]">{mod}</Badge>
                        ))}
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{step.outcome}</p>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Compliance Action Plan */}
          {analysis.compliance_action_plan?.length > 0 && (
            <SectionCard
              title="Compliance Action Plan"
              icon={<Shield className="w-5 h-5 text-red-600" />}
              isOpen={expandedSection === "compliance"}
              onToggle={() => toggle("compliance")}
            >
              <div className="space-y-2">
                {analysis.compliance_action_plan.map((item, idx) => (
                  <div key={idx} className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm font-medium text-red-900">{item.issue}</p>
                    <p className="text-xs text-red-700 mt-1"><strong>Action:</strong> {item.action}</p>
                    {item.training && <p className="text-xs text-red-600 mt-0.5"><strong>Training:</strong> {item.training}</p>}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Tips */}
          {analysis.personalized_tips?.length > 0 && (
            <Card className="bg-gradient-to-r from-blue-50 to-cyan-50 border-blue-200">
              <CardContent className="p-4">
                <h3 className="font-semibold text-blue-900 flex items-center gap-2 mb-3 text-sm">
                  <BookOpen className="w-4 h-4" /> Personalized Tips
                </h3>
                <ul className="space-y-1.5">
                  {analysis.personalized_tips.map((tip, idx) => (
                    <li key={idx} className="text-xs sm:text-sm text-blue-800 flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5 flex-shrink-0">💡</span> {tip}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }) {
  const colors = {
    blue: "from-blue-50 to-blue-100 border-blue-200 text-blue-700",
    green: "from-green-50 to-green-100 border-green-200 text-green-700",
    red: "from-red-50 to-red-100 border-red-200 text-red-700",
    amber: "from-amber-50 to-amber-100 border-amber-200 text-amber-700",
    purple: "from-purple-50 to-purple-100 border-purple-200 text-purple-700",
  };
  return (
    <Card className={`bg-gradient-to-br ${colors[color]}`}>
      <CardContent className="p-2 sm:p-3 text-center">
        <p className="text-lg sm:text-xl font-bold">{value}</p>
        <p className="text-[10px] sm:text-xs mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, icon, isOpen, onToggle, children }) {
  return (
    <Card>
      <button onClick={onToggle} className="w-full text-left">
        <CardHeader className="p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm sm:text-base">{icon}{title}</CardTitle>
            {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </div>
        </CardHeader>
      </button>
      {isOpen && <CardContent className="p-3 sm:p-4 pt-0">{children}</CardContent>}
    </Card>
  );
}