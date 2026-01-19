import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Send, 
  Calendar, 
  FileText, 
  CheckCircle2, 
  Loader2,
  Mail,
  Users,
  Clock
} from 'lucide-react';
import { toast } from 'sonner';

export default function PostConsultationAutomation({ 
  patientId, 
  visitId,
  visitNotes,
  diagnosis,
  onComplete 
}) {
  const [processing, setProcessing] = useState(false);
  const [actions, setActions] = useState({
    sendReferral: false,
    scheduleFollowUp: false,
    sendPatientSummary: false,
    updateCarePlan: false,
    notifyPhysician: false
  });
  const [referralSpecialty, setReferralSpecialty] = useState('');
  const [followUpDays, setFollowUpDays] = useState(7);

  const automatePostVisit = async () => {
    setProcessing(true);
    const completedActions = [];

    try {
      const patient = await base44.entities.Patient.get(patientId);

      // Send Referral
      if (actions.sendReferral && referralSpecialty) {
        const prompt = `Generate a professional referral letter for:

Patient: ${patient.first_name} ${patient.last_name}
Diagnosis: ${diagnosis}
Referral To: ${referralSpecialty}
Visit Notes: ${visitNotes?.substring(0, 500)}

Include reason for referral, relevant history, and requested consultation.`;

        const referralLetter = await base44.integrations.Core.InvokeLLM({ prompt });
        
        await base44.entities.Referral.create({
          patient_id: patientId,
          visit_id: visitId,
          specialty: referralSpecialty,
          referral_letter: referralLetter,
          status: 'pending',
          urgent: false
        });
        
        completedActions.push('Referral created');
      }

      // Schedule Follow-up
      if (actions.scheduleFollowUp) {
        const followUpDate = new Date();
        followUpDate.setDate(followUpDate.getDate() + followUpDays);

        await base44.entities.Task.create({
          patient_id: patientId,
          title: `Follow-up call - ${patient.first_name} ${patient.last_name}`,
          description: `Follow up on visit from ${new Date().toLocaleDateString()}. Diagnosis: ${diagnosis}`,
          priority: 'medium',
          due_date: followUpDate.toISOString().split('T')[0],
          type: 'call',
          source: 'ai_generated'
        });

        completedActions.push(`Follow-up scheduled for ${followUpDate.toLocaleDateString()}`);
      }

      // Send Patient Summary
      if (actions.sendPatientSummary && patient.email) {
        const summaryPrompt = `Create a patient-friendly visit summary:

Visit Date: ${new Date().toLocaleDateString()}
Main Points: ${visitNotes?.substring(0, 300)}
Next Steps: Include follow-up instructions

Use simple, reassuring language.`;

        const summary = await base44.integrations.Core.InvokeLLM({ prompt: summaryPrompt });

        await base44.integrations.Core.SendEmail({
          to: patient.email,
          subject: `Your Visit Summary - ${new Date().toLocaleDateString()}`,
          body: summary
        });

        completedActions.push('Patient summary emailed');
      }

      // Update Care Plan
      if (actions.updateCarePlan) {
        const carePlans = await base44.entities.CarePlan.filter({ 
          patient_id: patientId, 
          status: 'active' 
        });

        for (const plan of carePlans) {
          await base44.entities.CarePlan.update(plan.id, {
            last_reviewed_date: new Date().toISOString().split('T')[0]
          });
        }

        completedActions.push('Care plans updated');
      }

      // Notify Physician
      if (actions.notifyPhysician && patient.physician_email) {
        await base44.integrations.Core.SendEmail({
          to: patient.physician_email,
          subject: `Patient Update: ${patient.first_name} ${patient.last_name}`,
          body: `Visit completed on ${new Date().toLocaleDateString()}\n\nDiagnosis: ${diagnosis}\n\nBrief Summary: ${visitNotes?.substring(0, 200)}...\n\nPlease review full notes in the system.`
        });

        completedActions.push('Physician notified');
      }

      toast.success(`Completed ${completedActions.length} actions`);
      onComplete?.(completedActions);

    } catch (error) {
      console.error('Error in post-consultation automation:', error);
      toast.error('Some actions failed to complete');
    } finally {
      setProcessing(false);
    }
  };

  const selectedCount = Object.values(actions).filter(Boolean).length;

  return (
    <Card className="border-purple-200 dark:border-purple-800">
      <CardHeader className="bg-purple-50 dark:bg-purple-950">
        <CardTitle className="text-lg flex items-center gap-2">
          <Send className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          Post-Visit Automation
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 border rounded-lg">
            <Checkbox
              id="sendReferral"
              checked={actions.sendReferral}
              onCheckedChange={(checked) => setActions({ ...actions, sendReferral: checked })}
            />
            <div className="flex-1">
              <Label htmlFor="sendReferral" className="font-semibold text-sm flex items-center gap-2">
                <Users className="w-4 h-4" />
                Create & Send Referral
              </Label>
              {actions.sendReferral && (
                <Input
                  placeholder="Specialty (e.g., Cardiologist, Neurologist)"
                  value={referralSpecialty}
                  onChange={(e) => setReferralSpecialty(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 border rounded-lg">
            <Checkbox
              id="scheduleFollowUp"
              checked={actions.scheduleFollowUp}
              onCheckedChange={(checked) => setActions({ ...actions, scheduleFollowUp: checked })}
            />
            <div className="flex-1">
              <Label htmlFor="scheduleFollowUp" className="font-semibold text-sm flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Schedule Follow-up Task
              </Label>
              {actions.scheduleFollowUp && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    value={followUpDays}
                    onChange={(e) => setFollowUpDays(parseInt(e.target.value))}
                    className="w-20"
                    min="1"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">days from now</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 border rounded-lg">
            <Checkbox
              id="sendPatientSummary"
              checked={actions.sendPatientSummary}
              onCheckedChange={(checked) => setActions({ ...actions, sendPatientSummary: checked })}
            />
            <div className="flex-1">
              <Label htmlFor="sendPatientSummary" className="font-semibold text-sm flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Email Visit Summary to Patient
              </Label>
              <p className="text-xs text-gray-500 mt-1">Patient-friendly summary of today's visit</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 border rounded-lg">
            <Checkbox
              id="updateCarePlan"
              checked={actions.updateCarePlan}
              onCheckedChange={(checked) => setActions({ ...actions, updateCarePlan: checked })}
            />
            <div className="flex-1">
              <Label htmlFor="updateCarePlan" className="font-semibold text-sm flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Update Care Plan Review Date
              </Label>
              <p className="text-xs text-gray-500 mt-1">Mark care plans as reviewed today</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 border rounded-lg">
            <Checkbox
              id="notifyPhysician"
              checked={actions.notifyPhysician}
              onCheckedChange={(checked) => setActions({ ...actions, notifyPhysician: checked })}
            />
            <div className="flex-1">
              <Label htmlFor="notifyPhysician" className="font-semibold text-sm flex items-center gap-2">
                <Send className="w-4 h-4" />
                Notify Primary Physician
              </Label>
              <p className="text-xs text-gray-500 mt-1">Send update to patient's primary care physician</p>
            </div>
          </div>
        </div>

        <Button 
          onClick={automatePostVisit} 
          disabled={processing || selectedCount === 0}
          className="w-full bg-purple-600 hover:bg-purple-700"
        >
          {processing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing {selectedCount} Action{selectedCount !== 1 ? 's' : ''}...
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Complete {selectedCount} Action{selectedCount !== 1 ? 's' : ''}
            </>
          )}
        </Button>

        {selectedCount === 0 && (
          <p className="text-xs text-center text-gray-500">
            Select at least one action to automate
          </p>
        )}
      </CardContent>
    </Card>
  );
}