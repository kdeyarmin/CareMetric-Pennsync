import { useState, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Send, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';

export default function PersonalizedMaterialSender({ material, onClose, onSent }) {
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState('printed');
  const [notes, setNotes] = useState('');
  const [showPreview, setShowPreview] = useState(true);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-active'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }, 'last_name'),
    initialData: []
  });

  const { data: selectedPatient } = useQuery({
    queryKey: ['patient-detail', selectedPatientId],
    queryFn: () => base44.entities.Patient.filter({ id: selectedPatientId }),
    enabled: !!selectedPatientId,
    select: (data) => data[0]
  });

  // Personalize content
  const personalizedContent = useMemo(() => {
    if (!selectedPatient || !material.content) return material.content;

    let content = material.content;
    
    // Replace patient variables
    content = content.replace(/\{\{patient_name\}\}/g, `${selectedPatient.first_name} ${selectedPatient.last_name}`);
    content = content.replace(/\{\{first_name\}\}/g, selectedPatient.first_name || '');
    content = content.replace(/\{\{last_name\}\}/g, selectedPatient.last_name || '');
    content = content.replace(/\{\{diagnosis\}\}/g, selectedPatient.primary_diagnosis || 'your condition');
    content = content.replace(/\{\{primary_diagnosis\}\}/g, selectedPatient.primary_diagnosis || 'your primary diagnosis');
    
    // Replace medication variables
    content = content.replace(/\{\{medications\}\}/g, 'your medications');
    
    // Replace physician
    content = content.replace(/\{\{physician\}\}/g, selectedPatient.physician_name || 'your doctor');
    
    // Replace allergies
    content = content.replace(/\{\{allergies\}\}/g, selectedPatient.allergies || 'None known');

    return content;
  }, [selectedPatient, material.content]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      // Create the sent record FIRST, then bump usage_count — otherwise a failed
      // create left the counter incremented for a send that never happened.
      const sent = await base44.entities.SentEducationMaterial.create({
        material_id: material.id,
        material_title: material.title,
        patient_id: selectedPatientId,
        patient_name: `${selectedPatient.first_name} ${selectedPatient.last_name}`,
        personalized_content: personalizedContent,
        sent_by: currentUser?.email,
        sent_date: new Date().toISOString(),
        delivery_method: deliveryMethod,
        notes: notes
      });

      await base44.entities.EducationMaterial.update(material.id, {
        usage_count: (material.usage_count || 0) + 1,
        last_used_date: new Date().toISOString()
      });

      return sent;
    },
    onSuccess: () => {
      toast.success('Education material sent successfully');
      onSent();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to send material');
    }
  });

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send: {material.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Patient Selection */}
          <div>
            <Label>Select Patient *</Label>
            <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a patient..." />
              </SelectTrigger>
              <SelectContent>
                {patients.map(patient => (
                  <SelectItem key={patient.id} value={patient.id}>
                    {patient.first_name} {patient.last_name} - {patient.primary_diagnosis || 'No diagnosis'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Delivery Method */}
          <div>
            <Label>Delivery Method</Label>
            <Select value={deliveryMethod} onValueChange={setDeliveryMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="printed">Printed (Hand-delivered)</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="patient_portal">Patient Portal</SelectItem>
                <SelectItem value="text_message">Text Message</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes about this delivery..."
              rows={3}
            />
          </div>

          {/* Preview Toggle */}
          <div className="flex items-center justify-between">
            <Label>Personalized Preview</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
            >
              {showPreview ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
              {showPreview ? 'Hide' : 'Show'} Preview
            </Button>
          </div>

          {/* Preview */}
          {showPreview && selectedPatientId && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="pt-6">
                <div className="prose prose-sm max-w-none">
                  <div className="whitespace-pre-wrap text-sm text-slate-800">
                    {personalizedContent}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!selectedPatientId && showPreview && (
            <Card className="bg-slate-50">
              <CardContent className="py-8 text-center text-slate-500">
                Select a patient to see personalized preview
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => sendMutation.mutate()}
              // Also require selectedPatient (a separate async query): sending
              // while it's still loading throws on selectedPatient.first_name AFTER
              // the usage_count was already bumped — a partial write + generic error.
              disabled={!selectedPatientId || !selectedPatient || sendMutation.isPending}
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send to Patient
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}