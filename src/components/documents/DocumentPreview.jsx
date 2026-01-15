import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Mail, Copy, Edit2, Save, X, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import DocumentAIReview from './DocumentAIReview';

export default function DocumentPreview({ document, onClose, onSave, onSend, saving, patient }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(document.generated_content);
  const [patientEmail, setPatientEmail] = useState(document.patient_email || patient?.email || '');
  const [reviewExpanded, setReviewExpanded] = useState(false);

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('reviewDocument', {
        document_content: editedContent || document.generated_content,
        template_type: document.template_type
      });
      return response.data || response;
    }
  });

  const handleDownloadPDF = async () => {
    const element = document.getElementById('document-preview-content');
    const canvas = await html2canvas(element);
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);
    pdf.save(`${document.document_name}.pdf`);
  };

  const handleSaveChanges = () => {
    onSave({ ...document, generated_content: editedContent });
    setIsEditing(false);
  };

  const handleSendToPatient = () => {
    if (patientEmail) {
      onSend({ ...document, patient_email: patientEmail });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {document.document_name}
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <Card className="border-slate-300 dark:border-slate-600">
        <CardHeader>
          <CardTitle>Document Preview</CardTitle>
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="w-full h-96 p-4 border rounded font-mono text-sm"
            />
          ) : (
            <div
              id="document-preview-content"
              className="prose prose-sm max-w-none dark:prose-invert p-6 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700"
              dangerouslySetInnerHTML={{ __html: editedContent }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Share With Patient</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="patientEmail">Patient Email</Label>
            <Input
              id="patientEmail"
              type="email"
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
              placeholder="patient@example.com"
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Document will be marked as "sent" and access will be logged for HIPAA compliance.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Button
            variant="outline"
            onClick={() => setIsEditing(!isEditing)}
            className="w-full"
          >
            <Edit2 className="w-4 h-4 mr-2" />
            {isEditing ? 'View' : 'Edit'}
          </Button>

          {isEditing && (
            <Button
              onClick={handleSaveChanges}
              disabled={saving}
              className="bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700 text-slate-900 dark:text-white"
            >
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          )}

          <Button
            variant="outline"
            onClick={handleDownloadPDF}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            PDF
          </Button>

          <Button
            onClick={handleSendToPatient}
            disabled={saving || !patientEmail}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Mail className="w-4 h-4 mr-2" />
            Send
          </Button>

          <Button
            variant="outline"
            onClick={onClose}
            className="w-full"
          >
            Done
          </Button>
        </div>

        <Button
          onClick={() => {
            reviewMutation.mutate();
            setReviewExpanded(true);
          }}
          disabled={reviewMutation.isPending}
          className="w-full bg-green-600 hover:bg-green-700 text-white"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          {reviewMutation.isPending ? 'Analyzing...' : 'AI Quality Review'}
        </Button>
      </div>

      {reviewExpanded && (
        <div className="mt-6">
          <DocumentAIReview 
            review={reviewMutation.data?.review} 
            loading={reviewMutation.isPending}
          />
        </div>
      )}
    </div>
  );
}