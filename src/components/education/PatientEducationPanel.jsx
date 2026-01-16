import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Mail, Printer, CheckCircle2, Loader2, X, Link2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import EducationAssignmentDialog from "@/components/education/EducationAssignmentDialog";

export default function PatientEducationPanel({ 
  suggestedMaterials = [], 
  patientId, 
  patientEmail,
  onEducationProvided 
}) {
  const [selectedMaterials, setSelectedMaterials] = useState([]);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [assignmentDialog, setAssignmentDialog] = useState(null);
  const queryClient = useQueryClient();

  const { data: carePlans = [] } = useQuery({
    queryKey: ["carePlans", patientId],
    queryFn: async () => {
      return await base44.entities.CarePlan.filter({
        patient_id: patientId,
        status: "active"
      });
    },
    enabled: !!patientId
  });

  const toggleMaterial = (material) => {
    setSelectedMaterials(prev => {
      const exists = prev.find(m => m.id === material.id);
      if (exists) {
        return prev.filter(m => m.id !== material.id);
      }
      return [...prev, material];
    });
  };

  const handlePrint = (material) => {
    if (material.pdf_url || material.document_url) {
      window.open(material.pdf_url || material.document_url, '_blank');
      toast.success('Opening material for printing');
    } else if (material.content_text) {
      const printWindow = window.open('', '_blank');
      printWindow.document.write(`
        <html>
          <head>
            <title>${material.title}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 20px; }
              h1 { color: #333; }
              p { line-height: 1.6; }
            </style>
          </head>
          <body>
            <h1>${material.title}</h1>
            <p>${material.content_text}</p>
            <script>window.print();</script>
          </body>
        </html>
      `);
      printWindow.document.close();
    } else {
      toast.error('No printable content available');
    }
    
    markAsProvided(material, 'print');
  };

  const handleEmail = async (material) => {
    if (!patientEmail) {
      toast.error('Patient email not available');
      return;
    }

    setSendingEmail(true);
    try {
      const { sendPatientEducation } = await import('@/functions/sendPatientEducation');
      await sendPatientEducation({
        patient_id: patientId,
        material_id: material.id,
        patient_email: patientEmail
      });
      
      toast.success('Education material emailed to patient');
      markAsProvided(material, 'email');
    } catch (error) {
      console.error('Error sending education:', error);
      toast.error('Failed to send education material');
    } finally {
      setSendingEmail(false);
    }
  };

  const markAsProvided = async (material, method) => {
    try {
      const user = await base44.auth.me();

      // Create assignment record
      await base44.entities.PatientEducationAssignment.create({
        patient_id: patientId,
        education_material_id: material.id,
        material_title: material.title,
        assigned_by: user.email,
        assigned_date: new Date().toISOString(),
        provided_date: new Date().toISOString(),
        delivery_method: method,
        status: 'provided'
      });

      queryClient.invalidateQueries({ queryKey: ['educationAssignments', patientId] });
      
      if (onEducationProvided) {
        onEducationProvided(material, method);
      }
      
      toast.success('Education tracked successfully');
    } catch (error) {
      console.error('Error marking education as provided:', error);
      toast.error('Failed to track education');
    }
  };

  return (
    <Card className="border-teal-300 bg-teal-50 dark:bg-teal-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-teal-600" />
          Patient Education
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {suggestedMaterials.length === 0 ? (
          <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
            <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No education materials suggested</p>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestedMaterials.map((item, idx) => (
              <div
                key={idx}
                className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-teal-200 dark:border-teal-800"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1">{item.title}</h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                      {item.reason}
                    </p>
                    {item.category && (
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePrint(item)}
                    className="flex-1"
                  >
                    <Printer className="w-3 h-3 mr-1" />
                    Print
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleEmail(item)}
                    disabled={sendingEmail || !patientEmail}
                    className="flex-1 bg-teal-600 hover:bg-teal-700"
                  >
                    {sendingEmail ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Mail className="w-3 h-3 mr-1" />
                    )}
                    Email
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}