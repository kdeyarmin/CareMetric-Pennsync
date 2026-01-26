import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Users, 
  Stethoscope, 
  BookOpen, 
  CheckSquare, 
  TrendingUp,
  AlertCircle,
  Loader2,
  Send,
  Copy,
  Plus,
  Target,
  FileText,
  Brain,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';
import { Textarea } from '@/components/ui/textarea';

export default function AICareCoordinationPanel({ 
  enhancedNote, 
  visitType, 
  diagnosis, 
  patientId,
  vitalSigns = {},
  patientContext = null,
  onActionCreated = null
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [actions, setActions] = useState(null);
  const [selectedTab, setSelectedTab] = useState('referrals');
  const [editingReferral, setEditingReferral] = useState(null);

  const { data: carePlans = [] } = useQuery({
    queryKey: ['activeCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({
      patient_id: patientId,
      status: 'active'
    }),
    enabled: !!patientId && patientId !== 'no_patient'
  });

  const generateActions = async () => {
    if (!enhancedNote?.trim()) {
      toast.error('No clinical note to analyze');
      return;
    }

    setAnalyzing(true);
    try {
      const response = await base44.functions.invoke('generateCareCoordinationActions', {
        enhanced_note: enhancedNote,
        visit_type: visitType,
        diagnosis: diagnosis,
        patient_id: patientId !== 'no_patient' ? patientId : null,
        vital_signs: vitalSigns,
        patient_context: patientContext,
        care_plans: carePlans
      });

      const result = response.data || response;
      if (result.success) {
        setActions(result.coordination_actions);
        toast.success('Care coordination actions identified');
      } else {
        throw new Error(result.error || 'Failed to generate actions');
      }
    } catch (error) {
      console.error('Error generating coordination actions:', error);
      toast.error('Failed to generate care coordination actions');
    } finally {
      setAnalyzing(false);
    }
  };

  const createReferral = async (referral) => {
    try {
      await base44.entities.Referral.create({
        patient_id: patientId,
        referral_type: 'specialist',
        specialist_type: referral.specialist_type,
        reason: referral.reason,
        clinical_findings: referral.clinical_findings,
        urgency: referral.urgency,
        referral_note: editingReferral || referral.draft_referral_content,
        icd10_codes: referral.icd10_codes,
        status: 'pending',
        requested_by: (await base44.auth.me()).email
      });
      toast.success('Referral created successfully');
      setEditingReferral(null);
      onActionCreated?.('referral');
    } catch (error) {
      console.error('Error creating referral:', error);
      toast.error('Failed to create referral');
    }
  };

  const createEducationAssignment = async (education) => {
    try {
      await base44.entities.PatientEducationAssignment.create({
        patient_id: patientId,
        topic: education.topic,
        category: education.category,
        clinical_basis: education.clinical_basis,
        priority: education.priority,
        key_points: education.key_points,
        teach_back_questions: education.teach_back_questions,
        status: 'assigned',
        assigned_by: (await base44.auth.me()).email
      });
      toast.success('Education material assigned');
      onActionCreated?.('education');
    } catch (error) {
      console.error('Error assigning education:', error);
      toast.error('Failed to assign education');
    }
  };

  const createFollowUpTask = async (task) => {
    try {
      const dueDate = (() => {
        const today = new Date();
        switch (task.due_timeframe) {
          case 'today': return today.toISOString().split('T')[0];
          case '24 hours':
          case 'tomorrow':
            today.setDate(today.getDate() + 1);
            return today.toISOString().split('T')[0];
          case '48 hours':
          case 'this week':
            today.setDate(today.getDate() + 3);
            return today.toISOString().split('T')[0];
          default: return null;
        }
      })();

      await base44.entities.Task.create({
        title: task.task_title,
        description: task.task_description,
        priority: task.priority,
        type: 'care_coordination',
        due_date: dueDate,
        due_timeframe: task.due_timeframe,
        patient_id: patientId !== 'no_patient' ? patientId : null,
        assigned_to_role: task.assigned_to_role,
        source: 'ai_care_coordination',
        ai_reason: task.clinical_rationale,
        status: 'pending',
        related_care_plan: task.related_care_plan_goal
      });
      toast.success('Task created successfully');
      onActionCreated?.('task');
    } catch (error) {
      console.error('Error creating task:', error);
      toast.error('Failed to create task');
    }
  };

  const updateCarePlan = async (update) => {
    try {
      const matchingPlan = carePlans.find(cp => 
        cp.problem.toLowerCase().includes(update.existing_problem.toLowerCase())
      );

      if (matchingPlan) {
        const currentNotes = matchingPlan.progress_notes || [];
        await base44.entities.CarePlan.update(matchingPlan.id, {
          progress_notes: [
            ...currentNotes,
            {
              date: new Date().toISOString(),
              note: update.recommendation,
              type: update.update_type,
              documented_by: (await base44.auth.me()).email
            }
          ]
        });
        toast.success('Care plan updated');
        onActionCreated?.('care_plan_update');
      } else {
        toast.warning('Care plan not found for this update');
      }
    } catch (error) {
      console.error('Error updating care plan:', error);
      toast.error('Failed to update care plan');
    }
  };

  if (!enhancedNote) {
    return null;
  }

  return (
    <Card className="border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950 dark:to-slate-900">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900 rounded-xl">
              <Users className="w-6 h-6 text-indigo-600 dark:text-indigo-300" />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                AI Care Coordination
                <Badge variant="outline" className="text-xs">AI-Powered</Badge>
              </CardTitle>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Intelligent referrals, education, and task suggestions
              </p>
            </div>
          </div>
          {!actions && (
            <Button
              onClick={generateActions}
              disabled={analyzing}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Generate Actions
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {!actions && !analyzing && (
          <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-300">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900 dark:text-blue-100">
              <p className="font-semibold mb-1">AI-Powered Care Coordination</p>
              <p className="text-sm">Click "Generate Actions" to analyze this note and identify referrals, education needs, and follow-up tasks based on clinical findings and care plan goals.</p>
            </AlertDescription>
          </Alert>
        )}

        {actions && (
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="referrals" className="text-xs sm:text-sm">
                <Stethoscope className="w-3 h-3 mr-1" />
                Referrals ({(actions.specialist_referrals?.length || 0) + (actions.diagnostic_referrals?.length || 0)})
              </TabsTrigger>
              <TabsTrigger value="education" className="text-xs sm:text-sm">
                <BookOpen className="w-3 h-3 mr-1" />
                Education ({actions.patient_education_needs?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="tasks" className="text-xs sm:text-sm">
                <CheckSquare className="w-3 h-3 mr-1" />
                Tasks ({actions.follow_up_tasks?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="careplans" className="text-xs sm:text-sm">
                <Target className="w-3 h-3 mr-1" />
                Care Plans ({actions.care_plan_updates?.length || 0})
              </TabsTrigger>
              <TabsTrigger value="summary" className="text-xs sm:text-sm">
                <FileText className="w-3 h-3 mr-1" />
                Summary
              </TabsTrigger>
            </TabsList>

            {/* Specialist Referrals */}
            <TabsContent value="referrals" className="space-y-3 mt-4">
              {actions.specialist_referrals?.length === 0 && actions.diagnostic_referrals?.length === 0 ? (
                <Alert>
                  <AlertDescription>No referrals needed based on this clinical note.</AlertDescription>
                </Alert>
              ) : (
                <>
                  {actions.specialist_referrals?.map((referral, idx) => (
                    <Card key={idx} className="border-purple-200 bg-purple-50 dark:bg-purple-950">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold">{referral.specialist_type}</h4>
                              <Badge className={
                                referral.urgency === 'urgent' ? 'bg-red-600' :
                                referral.urgency === 'soon' ? 'bg-orange-500' : 'bg-blue-500'
                              }>
                                {referral.urgency}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-700 dark:text-gray-300">{referral.reason}</p>
                          </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-3 rounded border">
                          <p className="text-xs font-semibold mb-1">Clinical Findings:</p>
                          <p className="text-xs text-gray-700 dark:text-gray-300">{referral.clinical_findings}</p>
                        </div>

                        <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded">
                          <p className="text-xs font-semibold mb-2">Draft Referral:</p>
                          <Textarea
                            value={editingReferral === idx ? editingReferral : referral.draft_referral_content}
                            onChange={(e) => setEditingReferral(e.target.value)}
                            onFocus={() => setEditingReferral(referral.draft_referral_content)}
                            className="text-xs min-h-24"
                          />
                        </div>

                        {referral.icd10_codes?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            <span className="text-xs text-gray-600">ICD-10:</span>
                            {referral.icd10_codes.map((code, i) => (
                              <Badge key={i} variant="outline" className="text-xs">{code}</Badge>
                            ))}
                          </div>
                        )}

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => createReferral(referral)}
                            className="bg-purple-600 hover:bg-purple-700"
                          >
                            <Send className="w-3 h-3 mr-1" />
                            Create Referral
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              navigator.clipboard.writeText(referral.draft_referral_content);
                              toast.success('Referral copied');
                            }}
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            Copy
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}

                  {actions.diagnostic_referrals?.map((diagnostic, idx) => (
                    <Card key={idx} className="border-blue-200 bg-blue-50 dark:bg-blue-950">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-semibold">{diagnostic.test_type}</h4>
                              <Badge className={
                                diagnostic.urgency === 'stat' ? 'bg-red-600' :
                                diagnostic.urgency === 'urgent' ? 'bg-orange-500' : 'bg-blue-500'
                              }>
                                {diagnostic.urgency}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-700 dark:text-gray-300">{diagnostic.clinical_indication}</p>
                          </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-3 rounded text-xs">
                          <p className="font-semibold mb-1">Order Note:</p>
                          <p className="text-gray-700 dark:text-gray-300">{diagnostic.draft_order_note}</p>
                        </div>

                        <Button
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(diagnostic.draft_order_note);
                            toast.success('Order note copied');
                          }}
                          variant="outline"
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy Order Note
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </TabsContent>

            {/* Patient Education */}
            <TabsContent value="education" className="space-y-3 mt-4">
              {actions.patient_education_needs?.length === 0 ? (
                <Alert>
                  <AlertDescription>No specific education needs identified.</AlertDescription>
                </Alert>
              ) : (
                actions.patient_education_needs?.map((education, idx) => (
                  <Card key={idx} className="border-green-200 bg-green-50 dark:bg-green-950">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">{education.topic}</h4>
                            <Badge className={
                              education.priority === 'high' ? 'bg-red-600' :
                              education.priority === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                            }>
                              {education.priority}
                            </Badge>
                            <Badge variant="outline">{education.category}</Badge>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                            <strong>Why:</strong> {education.clinical_basis}
                          </p>
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-900 p-3 rounded border">
                        <p className="text-xs font-semibold mb-2">Key Teaching Points:</p>
                        <ul className="space-y-1">
                          {education.key_points?.map((point, i) => (
                            <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2">
                              <span className="text-green-600">•</span>
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {education.teach_back_questions?.length > 0 && (
                        <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded">
                          <p className="text-xs font-semibold mb-2">Teach-Back Questions:</p>
                          <ul className="space-y-1">
                            {education.teach_back_questions.map((q, i) => (
                              <li key={i} className="text-xs text-blue-800 dark:text-blue-200">
                                {i + 1}. {q}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <Button
                        size="sm"
                        onClick={() => createEducationAssignment(education)}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Assign Education
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* Follow-Up Tasks */}
            <TabsContent value="tasks" className="space-y-3 mt-4">
              {actions.follow_up_tasks?.length === 0 ? (
                <Alert>
                  <AlertDescription>No follow-up tasks identified.</AlertDescription>
                </Alert>
              ) : (
                actions.follow_up_tasks?.map((task, idx) => (
                  <Card key={idx} className="border-orange-200 bg-orange-50 dark:bg-orange-950">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold">{task.task_title}</h4>
                            <Badge className={
                              task.priority === 'critical' ? 'bg-red-600' :
                              task.priority === 'high' ? 'bg-orange-600' :
                              task.priority === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                            }>
                              {task.priority}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-700 dark:text-gray-300">{task.task_description}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-white dark:bg-slate-900 p-2 rounded">
                          <span className="font-semibold">Assign to:</span> {task.assigned_to_role}
                        </div>
                        <div className="bg-white dark:bg-slate-900 p-2 rounded">
                          <span className="font-semibold">Due:</span> {task.due_timeframe}
                        </div>
                      </div>

                      <div className="bg-blue-50 dark:bg-blue-900 p-3 rounded">
                        <p className="text-xs font-semibold mb-1">Clinical Rationale:</p>
                        <p className="text-xs text-blue-800 dark:text-blue-200">{task.clinical_rationale}</p>
                      </div>

                      {task.related_care_plan_goal && (
                        <div className="text-xs bg-purple-50 dark:bg-purple-900 p-2 rounded">
                          <span className="font-semibold">Related Goal:</span> {task.related_care_plan_goal}
                        </div>
                      )}

                      <Button
                        size="sm"
                        onClick={() => createFollowUpTask(task)}
                        className="bg-orange-600 hover:bg-orange-700"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Create Task
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* Care Plan Updates */}
            <TabsContent value="careplans" className="space-y-3 mt-4">
              {actions.care_plan_updates?.length === 0 ? (
                <Alert>
                  <AlertDescription>No care plan updates recommended.</AlertDescription>
                </Alert>
              ) : (
                actions.care_plan_updates?.map((update, idx) => (
                  <Card key={idx} className="border-teal-200 bg-teal-50 dark:bg-teal-950">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className="bg-teal-600">{update.update_type.replace(/_/g, ' ')}</Badge>
                        <span className="text-sm font-semibold">{update.existing_problem}</span>
                      </div>

                      <div className="bg-white dark:bg-slate-900 p-3 rounded">
                        <p className="text-xs font-semibold mb-1">Recommendation:</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300">{update.recommendation}</p>
                      </div>

                      <div className="bg-blue-50 dark:bg-blue-900 p-2 rounded text-xs">
                        <span className="font-semibold">Clinical Basis:</span> {update.clinical_basis}
                      </div>

                      <Button
                        size="sm"
                        onClick={() => updateCarePlan(update)}
                        className="bg-teal-600 hover:bg-teal-700"
                      >
                        <TrendingUp className="w-3 h-3 mr-1" />
                        Update Care Plan
                      </Button>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* Summary */}
            <TabsContent value="summary" className="mt-4">
              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
                    <div className="bg-purple-50 dark:bg-purple-950 p-3 rounded text-center">
                      <p className="text-2xl font-bold text-purple-600">{(actions.specialist_referrals?.length || 0) + (actions.diagnostic_referrals?.length || 0)}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Referrals</p>
                    </div>
                    <div className="bg-green-50 dark:bg-green-950 p-3 rounded text-center">
                      <p className="text-2xl font-bold text-green-600">{actions.patient_education_needs?.length || 0}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Education Topics</p>
                    </div>
                    <div className="bg-orange-50 dark:bg-orange-950 p-3 rounded text-center">
                      <p className="text-2xl font-bold text-orange-600">{actions.follow_up_tasks?.length || 0}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Follow-Up Tasks</p>
                    </div>
                    <div className="bg-teal-50 dark:bg-teal-950 p-3 rounded text-center">
                      <p className="text-2xl font-bold text-teal-600">{actions.care_plan_updates?.length || 0}</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Care Plan Updates</p>
                    </div>
                  </div>

                  <Alert className="bg-indigo-50 dark:bg-indigo-950 border-indigo-300">
                    <Brain className="w-4 h-4 text-indigo-600" />
                    <AlertDescription className="text-indigo-900 dark:text-indigo-100">
                      <p className="font-semibold mb-2">AI Analysis Complete</p>
                      <p className="text-sm">
                        Based on your clinical note, the AI has identified {
                          (actions.specialist_referrals?.length || 0) + 
                          (actions.diagnostic_referrals?.length || 0) +
                          (actions.patient_education_needs?.length || 0) +
                          (actions.follow_up_tasks?.length || 0) +
                          (actions.care_plan_updates?.length || 0)
                        } care coordination actions to optimize patient outcomes and ensure comprehensive care delivery.
                      </p>
                    </AlertDescription>
                  </Alert>

                  <Button
                    onClick={generateActions}
                    variant="outline"
                    className="w-full mt-4"
                  >
                    <Brain className="w-4 h-4 mr-2" />
                    Re-analyze Note
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}