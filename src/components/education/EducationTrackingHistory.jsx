import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Calendar, User, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

export default function EducationTrackingHistory({ patientId }) {
  const { data: educationHistory = [] } = useQuery({
    queryKey: ['educationHistory', patientId],
    queryFn: async () => {
      const assignments = await base44.entities.PatientEducationAssignment.filter({
        patient_id: patientId
      });
      return assignments.sort((a, b) => 
        new Date(b.provided_date || b.assigned_date) - new Date(a.provided_date || a.assigned_date)
      );
    },
    enabled: !!patientId
  });

  if (!patientId) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="w-4 h-4" />
          Education History ({educationHistory.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {educationHistory.length === 0 ? (
          <p className="text-sm text-gray-600">No education materials provided yet</p>
        ) : (
          <div className="space-y-3">
            {educationHistory.map((item) => (
              <div key={item.id} className="border rounded-lg p-3 bg-gray-50 dark:bg-gray-900">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-sm">{item.material_title}</h4>
                  <Badge className={
                    item.status === 'provided' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }>
                    {item.status}
                  </Badge>
                </div>
                
                <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3 h-3" />
                    Provided: {item.provided_date ? format(new Date(item.provided_date), 'MMM d, yyyy') : 'Not yet'}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3" />
                    Method: {item.delivery_method?.replace('_', ' ')}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <User className="w-3 h-3" />
                    By: {item.assigned_by}
                  </div>

                  {item.care_plan_problem && (
                    <div className="text-xs bg-blue-50 dark:bg-blue-900 p-2 rounded mt-2">
                      Related to: {item.care_plan_problem}
                    </div>
                  )}

                  {item.notes && (
                    <p className="mt-2 italic">{item.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}