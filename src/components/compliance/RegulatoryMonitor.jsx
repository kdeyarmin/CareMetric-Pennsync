import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Bell,
  RefreshCw,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Settings,
  Eye,
  XCircle,
  Sparkles,
  GraduationCap,
  ChevronDown,
  ChevronUp,
  Calendar
} from "lucide-react";
import { format } from "date-fns";

export default function RegulatoryMonitor({ isAdmin = false }) {
  const queryClient = useQueryClient();
  const ai = useAICall();
  const [selectedUpdate, setSelectedUpdate] = useState(null);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [implementationNotes, setImplementationNotes] = useState("");
  const [lastScanDate, setLastScanDate] = useState(null);
  // Explicit human confirmation gate: ComplianceRule rows are NEVER mutated from
  // AI-suggested content unless an admin ticks this box for the open update.
  const [confirmRuleChanges, setConfirmRuleChanges] = useState(false);

  const { data: updates = [] } = useQuery({
    queryKey: ['regulatoryUpdates'],
    queryFn: () => base44.entities.RegulatoryUpdate.filter({}, '-created_date'),
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  useEffect(() => {
    try {
      const cached = localStorage.getItem('last_regulatory_scan');
      if (cached) setLastScanDate(new Date(cached));
    } catch {}
  }, []);

  const createUpdateMutation = useMutation({
    mutationFn: (data) => base44.entities.RegulatoryUpdate.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['regulatoryUpdates'] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.RegulatoryUpdate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatoryUpdates'] });
      setReviewDialogOpen(false);
      setSelectedUpdate(null);
    },
  });

  const scanForUpdates = async () => {

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a healthcare regulatory monitoring assistant for a home health/hospice agency.

Current date: ${format(new Date(), 'yyyy-MM-dd')}

IMPORTANT — DO NOT FABRICATE. Do NOT invent specific regulations, rule numbers,
citation references, or effective dates. If you are not certain a specific
regulation exists and is real, do not state it as fact.

Instead, produce 3-5 DRAFT REVIEW TOPICS: general, well-established compliance
areas a home health/hospice agency should periodically re-verify against the
official source (CMS, Medicare, State health department, OSHA, CDC, Joint
Commission). These are AI-suggested prompts for a human compliance officer to
research and confirm — NOT authoritative notices of new rules.

For each topic:
- Frame the title and summary as a topic to review (e.g. "Review: OASIS
  documentation timeliness requirements"), not as an announced change.
- Do NOT assert a specific effective_date unless it is a real, well-known,
  verifiable date; otherwise leave effective_date empty.
- In required_actions, the FIRST action must be to verify the topic against the
  official primary source before acting.
- compliance_check_updates are SUGGESTED checks to consider; phrase new_requirement
  as a proposal to confirm, never as an in-force mandate.

Return JSON:
{
  "updates": [
    {
      "title": "review topic title (framed as a topic to verify)",
      "source": "CMS" | "Medicare" | "Medicaid" | "State" | "OSHA" | "CDC" | "Joint_Commission" | "Other",
      "category": "documentation" | "oasis" | "safety" | "billing" | "quality" | "infection_control" | "patient_rights" | "hipaa" | "staffing",
      "effective_date": "YYYY-MM-DD or empty string if not a known, verifiable date",
      "summary": "2-3 sentence summary framed as 'review/confirm', not 'this changed'",
      "full_details": "what to research and why it matters",
      "impact_level": "critical" | "high" | "medium" | "low",
      "affected_areas": ["list of affected practice areas"],
      "required_actions": ["FIRST: verify against the official primary source", "..."],
      "compliance_check_updates": [
        {
          "check_name": "suggested check to consider",
          "old_requirement": "current practice (if known)",
          "new_requirement": "proposed requirement to confirm with the official source"
        }
      ],
      "suggested_training": ["training topics for nurses"],
      "reference_url": "official source to verify (e.g. cms.gov), or empty string"
    }
  ],
  "scan_summary": "brief note that these are AI-suggested review topics requiring human verification"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            updates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  source: { type: "string" },
                  category: { type: "string" },
                  effective_date: { type: "string" },
                  summary: { type: "string" },
                  full_details: { type: "string" },
                  impact_level: { type: "string" },
                  affected_areas: { type: "array", items: { type: "string" } },
                  required_actions: { type: "array", items: { type: "string" } },
                  compliance_check_updates: { type: "array" },
                  suggested_training: { type: "array", items: { type: "string" } },
                  reference_url: { type: "string" }
                }
              }
            },
            scan_summary: { type: "string" }
          }
        },
        add_context_from_internet: true
      });

      // Persist as AI-suggested DRAFTS pending human review. These are research
      // prompts, not verified regulatory notices. The schema has no dedicated
      // "is_ai_draft" field, so the draft caveat is folded into the summary so it
      // travels with the record everywhere it is shown.
      const DRAFT_PREFIX = '[AI-SUGGESTED DRAFT — verify against the official source before acting] ';
      for (const update of result.updates || []) {
        const summary = update.summary?.startsWith(DRAFT_PREFIX)
          ? update.summary
          : `${DRAFT_PREFIX}${update.summary || ''}`;
        await createUpdateMutation.mutateAsync({
          ...update,
          summary,
          status: 'pending_review',
        });
      }

      try { localStorage.setItem('last_regulatory_scan', new Date().toISOString()); } catch {}
      setLastScanDate(new Date());

    } catch (error) {
      console.error("Error scanning for updates:", error);
    }

  };

  const handleReview = (update) => {
    setSelectedUpdate(update);
    setImplementationNotes("");
    setConfirmRuleChanges(false);
    setReviewDialogOpen(true);
  };

  // Build a stable, auditor-matchable rule_code for any ComplianceRule created
  // from a regulatory update so auditors can trace it back to its source.
  const buildRuleCode = (update, checkName) => {
    const src = (update?.source || 'REG').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'REG';
    const slug = String(checkName || 'rule')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    return `REG-${src}-${slug}`;
  };

  const handleApprove = async () => {
    if (!selectedUpdate) return;

    await updateMutation.mutateAsync({
      id: selectedUpdate.id,
      data: {
        status: 'approved',
        reviewed_by: currentUser?.email,
        reviewed_at: new Date().toISOString(),
        implementation_notes: implementationNotes
      }
    });
  };

  // Map a RegulatoryUpdate.category / source to a valid ComplianceRule.rule_category.
  const mapRuleCategory = (update) => {
    switch (update?.category) {
      case 'oasis': return 'oasis';
      case 'hipaa': return 'hipaa';
      case 'quality': return 'quality_measure';
      case 'billing':
      case 'documentation': return 'medicare_cop';
      default:
        return update?.source === 'State' ? 'state_regulation' : 'agency_policy';
    }
  };

  const handleImplement = async () => {
    if (!selectedUpdate) return;

    // 1. ComplianceRule changes are NOT applied automatically from AI-suggested
    //    content. They are only created/updated when an admin has explicitly
    //    confirmed (the "confirm rule changes" checkbox). Any rule created this
    //    way is given a traceable rule_code so auditors can match it back to its
    //    source regulatory update.
    const appliedChecks = [];
    if (confirmRuleChanges) {
      try {
        for (const change of (selectedUpdate.compliance_check_updates || [])) {
          if (!change?.check_name) continue;
          const existing = await base44.entities.ComplianceRule
            .filter({ rule_name: change.check_name }, '-created_date', 1)
            .catch(() => []);
          const description = change.new_requirement || existing[0]?.description || selectedUpdate.summary;
          const severity = ['critical', 'high', 'medium', 'low'].includes(selectedUpdate.impact_level)
            ? selectedUpdate.impact_level
            : 'medium';
          const ruleCode = existing[0]?.rule_code || buildRuleCode(selectedUpdate, change.check_name);
          // rule_code carries the auditor-matchable trace (it encodes the source
          // and check name); the source update id is also noted in the description.
          const tracedDescription = `${description}\n\n[Source: regulatory update ${selectedUpdate.id} — ${selectedUpdate.title}]`;
          if (existing[0]) {
            await base44.entities.ComplianceRule.update(existing[0].id, {
              description: tracedDescription,
              severity,
              is_active: true,
              rule_code: ruleCode,
              ...(selectedUpdate.effective_date ? { effective_date: selectedUpdate.effective_date } : {}),
            });
          } else {
            await base44.entities.ComplianceRule.create({
              rule_name: change.check_name,
              rule_code: ruleCode,
              rule_category: mapRuleCategory(selectedUpdate),
              description: tracedDescription,
              severity,
              is_active: true,
              ...(selectedUpdate.effective_date ? { effective_date: selectedUpdate.effective_date } : {}),
            });
          }
          appliedChecks.push(change.check_name);
        }
      } catch (err) {
        console.error('Failed to apply compliance updates:', err);
      }
    }

    // 2. Queue staff training as an admin task rather than auto-enrolling everyone
    //    (suggested_training are free-text topics, not specific course ids).
    let trainingTaskCreated = false;
    try {
      const topics = selectedUpdate.suggested_training || [];
      if (topics.length > 0 && currentUser?.email) {
        await base44.entities.Task.create({
          title: `Assign staff training: ${selectedUpdate.title}`,
          description:
            `Regulatory update "${selectedUpdate.title}" (${selectedUpdate.source}) requires staff training on:\n` +
            topics.map((t) => `- ${t}`).join('\n'),
          type: 'coordinate',
          priority: (selectedUpdate.impact_level === 'critical' || selectedUpdate.impact_level === 'high')
            ? 'high'
            : 'medium',
          status: 'pending',
          assigned_to: currentUser.email,
          source: 'manual',
        });
        trainingTaskCreated = true;
      }
    } catch (err) {
      console.error('Failed to create training task:', err);
    }

    // 3. Record what was actually applied in the implementation notes.
    const summaryNote = [
      implementationNotes,
      appliedChecks.length
        ? `Compliance checks created/updated after explicit admin confirmation: ${appliedChecks.join(', ')}.`
        : 'No ComplianceRule changes were applied (admin did not confirm automated rule changes).',
      trainingTaskCreated ? `Training task created for: ${(selectedUpdate.suggested_training || []).join(', ')}.` : '',
    ].filter(Boolean).join('\n');

    await updateMutation.mutateAsync({
      id: selectedUpdate.id,
      data: {
        status: 'implemented',
        reviewed_by: currentUser?.email,
        reviewed_at: new Date().toISOString(),
        implementation_notes: summaryNote,
      }
    });
  };

  const handleDismiss = async () => {
    if (!selectedUpdate) return;

    await updateMutation.mutateAsync({
      id: selectedUpdate.id,
      data: {
        status: 'dismissed',
        reviewed_by: currentUser?.email,
        reviewed_at: new Date().toISOString(),
        implementation_notes: implementationNotes
      }
    });
  };

  const pendingUpdates = updates.filter(u => u.status === 'pending_review');
  const approvedUpdates = updates.filter(u => u.status === 'approved');
  const implementedUpdates = updates.filter(u => u.status === 'implemented');

  const getImpactColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending_review': return 'bg-yellow-100 text-yellow-800';
      case 'under_review': return 'bg-blue-100 text-blue-800';
      case 'approved': return 'bg-green-100 text-green-800';
      case 'implemented': return 'bg-navy-100 text-navy-800';
      case 'dismissed': return 'bg-slate-100 text-slate-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'documentation': return <FileText className="w-4 h-4" />;
      case 'safety': return <Shield className="w-4 h-4" />;
      case 'quality': return <CheckCircle2 className="w-4 h-4" />;
      default: return <Bell className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-indigo-200">
        <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-600" />
              Regulatory Change Monitor
            </CardTitle>
            <div className="flex items-center gap-2">
              {lastScanDate && (
                <span className="text-xs text-slate-500">
                  Last scan: {format(lastScanDate, 'MMM d, h:mm a')}
                </span>
              )}
              {isAdmin && (
                <Button
                  onClick={scanForUpdates}
                  disabled={ai.loading}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {ai.loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Scan for Updates
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            <div className="text-center p-3 bg-yellow-50 rounded-lg">
              <p className="text-2xl font-bold text-yellow-600">{pendingUpdates.length}</p>
              <p className="text-xs text-slate-600">Pending Review</p>
            </div>
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <p className="text-2xl font-bold text-green-600">{approvedUpdates.length}</p>
              <p className="text-xs text-slate-600">Approved</p>
            </div>
            <div className="text-center p-3 bg-navy-50 rounded-lg">
              <p className="text-2xl font-bold text-navy-600">{implementedUpdates.length}</p>
              <p className="text-xs text-slate-600">Implemented</p>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <p className="text-2xl font-bold text-red-600">
                {updates.filter(u => u.impact_level === 'critical' && u.status === 'pending_review').length}
              </p>
              <p className="text-xs text-slate-600">Critical Pending</p>
            </div>
          </div>

          {/* Pending Critical Alert */}
          {pendingUpdates.filter(u => u.impact_level === 'critical').length > 0 && (
            <Alert className="bg-red-50 border-red-200 mb-4">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <strong>Action Required:</strong> {pendingUpdates.filter(u => u.impact_level === 'critical').length} critical regulatory update(s) require immediate review
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Updates Tabs */}
      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto gap-1">
          <TabsTrigger value="pending" className="flex flex-col md:flex-row gap-1 py-2 px-2 text-xs md:text-sm">
            <Clock className="w-3 h-3 md:w-4 md:h-4" />
            <span>Pending ({pendingUpdates.length})</span>
          </TabsTrigger>
          <TabsTrigger value="approved" className="flex flex-col md:flex-row gap-1 py-2 px-2 text-xs md:text-sm">
            <CheckCircle2 className="w-3 h-3 md:w-4 md:h-4" />
            <span>Approved ({approvedUpdates.length})</span>
          </TabsTrigger>
          <TabsTrigger value="implemented" className="flex flex-col md:flex-row gap-1 py-2 px-2 text-xs md:text-sm">
            <Settings className="w-3 h-3 md:w-4 md:h-4" />
            <span>Implemented ({implementedUpdates.length})</span>
          </TabsTrigger>
          <TabsTrigger value="all" className="flex flex-col md:flex-row gap-1 py-2 px-2 text-xs md:text-sm">
            <FileText className="w-3 h-3 md:w-4 md:h-4" />
            <span>All ({updates.length})</span>
          </TabsTrigger>
        </TabsList>

        {['pending', 'approved', 'implemented', 'all'].map(tab => (
          <TabsContent key={tab} value={tab} className="space-y-3">
            {(tab === 'pending' ? pendingUpdates :
              tab === 'approved' ? approvedUpdates :
              tab === 'implemented' ? implementedUpdates :
              updates
            ).length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-300" />
                  <p className="text-slate-500">No updates in this category</p>
                </CardContent>
              </Card>
            ) : (
              (tab === 'pending' ? pendingUpdates :
                tab === 'approved' ? approvedUpdates :
                tab === 'implemented' ? implementedUpdates :
                updates
              ).map(update => (
                <RegulatoryUpdateCard
                  key={update.id}
                  update={update}
                  isAdmin={isAdmin}
                  onReview={() => handleReview(update)}
                  getImpactColor={getImpactColor}
                  getStatusColor={getStatusColor}
                  getCategoryIcon={getCategoryIcon}
                />
              ))
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-600" />
              Review Regulatory Update
            </DialogTitle>
          </DialogHeader>

          {selectedUpdate && (
            <div className="space-y-4">
              <Alert className="bg-amber-50 border-amber-300">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-900 text-sm">
                  <strong>AI-suggested draft.</strong> This item was generated as a review topic and may
                  not reflect a real or current regulation. Verify it against the official primary source
                  before taking any action. Approving or implementing does not certify accuracy.
                </AlertDescription>
              </Alert>

              {/* Update Details */}
              <div>
                <h3 className="font-semibold text-lg">{selectedUpdate.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={getImpactColor(selectedUpdate.impact_level)}>
                    {selectedUpdate.impact_level}
                  </Badge>
                  <Badge variant="outline">{selectedUpdate.source}</Badge>
                  <Badge variant="outline">{selectedUpdate.category}</Badge>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-lg">
                <p className="text-sm text-slate-700">{selectedUpdate.summary}</p>
              </div>

              <div>
                <p className="text-sm font-medium mb-1">Effective Date:</p>
                <p className="text-sm text-slate-700">
                  {selectedUpdate.effective_date ? format(new Date(selectedUpdate.effective_date), 'MMMM d, yyyy') : 'TBD'}
                </p>
              </div>

              <div>
                <p className="text-sm font-medium mb-1">Full Details:</p>
                <p className="text-sm text-slate-700">{selectedUpdate.full_details}</p>
              </div>

              {/* Required Actions */}
              {selectedUpdate.required_actions?.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Required Actions:</p>
                  <ul className="text-sm text-slate-700 list-disc list-inside space-y-1">
                    {selectedUpdate.required_actions.map((action, idx) => (
                      <li key={idx}>{action}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Compliance Check Updates */}
              {selectedUpdate.compliance_check_updates?.length > 0 && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-sm font-semibold text-blue-900 mb-2 flex items-center gap-1">
                    <Settings className="w-4 h-4" />
                    Compliance Check Updates Required:
                  </p>
                  {selectedUpdate.compliance_check_updates.map((check, idx) => (
                    <div key={idx} className="text-xs bg-white p-2 rounded mb-1 last:mb-0">
                      <p className="font-medium text-blue-900">{check.check_name}</p>
                      <p className="text-slate-500">Old: {check.old_requirement}</p>
                      <p className="text-green-700">New: {check.new_requirement}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Suggested Training */}
              {selectedUpdate.suggested_training?.length > 0 && (
                <div className="bg-navy-50 p-3 rounded-lg">
                  <p className="text-sm font-semibold text-navy-900 mb-2 flex items-center gap-1">
                    <GraduationCap className="w-4 h-4" />
                    Training to Assign to Nurses:
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {selectedUpdate.suggested_training.map((topic, idx) => (
                      <Badge key={idx} className="bg-navy-100 text-navy-800">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Explicit confirmation to mutate ComplianceRule rows */}
              {selectedUpdate.compliance_check_updates?.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="confirm-rule-changes"
                      checked={confirmRuleChanges}
                      onCheckedChange={(v) => setConfirmRuleChanges(!!v)}
                      className="mt-0.5"
                    />
                    <label htmlFor="confirm-rule-changes" className="text-xs text-red-900 cursor-pointer">
                      <span className="font-semibold">I have verified these against the official source</span> and
                      authorize creating/updating live ComplianceRule records from this update. Leaving this
                      unchecked records the review and training task but makes NO changes to compliance rules.
                    </label>
                  </div>
                </div>
              )}

              {/* Implementation Notes */}
              <div>
                <p className="text-sm font-medium mb-1">Implementation Notes:</p>
                <Textarea
                  placeholder="Add notes about how this update will be implemented..."
                  value={implementationNotes}
                  onChange={(e) => setImplementationNotes(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setReviewDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              variant="outline" 
              onClick={handleDismiss}
              className="text-red-600 hover:text-red-700"
            >
              <XCircle className="w-4 h-4 mr-1" />
              Dismiss
            </Button>
            <Button 
              onClick={handleApprove}
              className="bg-green-600 hover:bg-green-700"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />
              Approve
            </Button>
            <Button 
              onClick={handleImplement}
              className="bg-navy-600 hover:bg-navy-700"
            >
              <Settings className="w-4 h-4 mr-1" />
              Implement Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RegulatoryUpdateCard({ update, isAdmin, onReview, getImpactColor, getStatusColor, getCategoryIcon }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className={`border-l-4 ${
      update.impact_level === 'critical' ? 'border-l-red-500 bg-red-50/30' :
      update.impact_level === 'high' ? 'border-l-orange-500' :
      'border-l-blue-500'
    }`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {getCategoryIcon(update.category)}
              <h4 className="font-semibold">{update.title}</h4>
            </div>
            <div className="flex items-center gap-2 mb-2">
              <Badge className={getImpactColor(update.impact_level)}>
                {update.impact_level}
              </Badge>
              <Badge variant="outline">{update.source}</Badge>
              <Badge className={getStatusColor(update.status)}>
                {update.status.replace('_', ' ')}
              </Badge>
              {update.effective_date && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  Effective: {format(new Date(update.effective_date), 'MMM d, yyyy')}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-700">{update.summary}</p>

            {expanded && (
              <div className="mt-3 space-y-2 text-sm">
                <p className="text-slate-600">{update.full_details}</p>
                {update.suggested_training?.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <GraduationCap className="w-4 h-4 text-navy-600" />
                    {update.suggested_training.map((t, i) => (
                      <Badge key={i} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
            {isAdmin && update.status === 'pending_review' && (
              <Button size="sm" onClick={onReview}>
                <Eye className="w-4 h-4 mr-1" />
                Review
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}