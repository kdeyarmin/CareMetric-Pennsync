import React, { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { BookOpen, Clock, Eye, Send, Globe, Star } from 'lucide-react';
import { toast } from 'sonner';

export default function EducationMaterialCard({ material, patientId, showAssignButton = false }) {
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [parsedContent, setParsedContent] = useState(null);
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const trackEngagementMutation = useMutation({
    mutationFn: async (actionType) => {
      await base44.entities.PatientEducationEngagement.create({
        patient_id: patientId,
        material_id: material.id,
        action_type: actionType,
        language_used: material.language
      });
    }
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      await base44.entities.PatientEducationAssignment.create({
        patient_id: patientId,
        material_id: material.id,
        assigned_by: user.email,
        assigned_by_name: user.full_name,
        status: 'assigned',
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['educationAssignments'] });
      toast.success('Material assigned to patient');
    }
  });

  const handleView = () => {
    try {
      const content = typeof material.content === 'string' 
        ? JSON.parse(material.content) 
        : material.content;
      setParsedContent(content);
      setViewDialogOpen(true);
      trackEngagementMutation.mutate('viewed');
    } catch (error) {
      console.error('Error parsing content:', error);
      toast.error('Unable to display content');
    }
  };

  const getLanguageFlag = (lang) => {
    const flags = { en: '🇺🇸', es: '🇪🇸', zh: '🇨🇳', ar: '🇸🇦', fr: '🇫🇷', de: '🇩🇪' };
    return flags[lang] || '🌐';
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{material.title}</CardTitle>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="capitalize">
                  {material.category?.replace(/_/g, ' ')}
                </Badge>
                <Badge variant="outline">
                  <Globe className="h-3 w-3 mr-1" />
                  {getLanguageFlag(material.language)} {material.language?.toUpperCase()}
                </Badge>
                {material.estimated_reading_time_minutes && (
                  <Badge variant="outline">
                    <Clock className="h-3 w-3 mr-1" />
                    {material.estimated_reading_time_minutes} min
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {material.key_points?.length > 0 && (
            <ul className="list-disc list-inside text-sm text-gray-600 mb-3 space-y-1">
              {material.key_points.slice(0, 3).map((point, idx) => (
                <li key={idx}>{point}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleView}>
              <Eye className="h-4 w-4 mr-1" />
              View Content
            </Button>
            {showAssignButton && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => assignMutation.mutate()}
                disabled={assignMutation.isPending}
              >
                <Send className="h-4 w-4 mr-1" />
                Assign to Patient
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* View Content Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{parsedContent?.title}</DialogTitle>
          </DialogHeader>
          {parsedContent && (
            <div className="space-y-6">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm">{parsedContent.overview}</p>
              </div>

              {parsedContent.content_sections?.map((section, idx) => (
                <div key={idx} className="space-y-2">
                  <h3 className="font-semibold text-lg">{section.section_title}</h3>
                  <p className="text-sm whitespace-pre-wrap">{section.content}</p>
                </div>
              ))}

              {parsedContent.key_takeaways?.length > 0 && (
                <div className="bg-green-50 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2">🎯 Key Takeaways</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {parsedContent.key_takeaways.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {parsedContent.warning_signs?.length > 0 && (
                <div className="bg-red-50 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2">⚠️ Warning Signs - Seek Help If:</h4>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {parsedContent.warning_signs.map((sign, idx) => (
                      <li key={idx}>{sign}</li>
                    ))}
                  </ul>
                </div>
              )}

              {parsedContent.action_items?.length > 0 && (
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2">✅ Action Items</h4>
                  {parsedContent.action_items.map((item, idx) => (
                    <div key={idx} className="text-sm mb-2">
                      <span className="font-medium">{item.timeframe}:</span> {item.action}
                    </div>
                  ))}
                </div>
              )}

              {parsedContent.teach_back_questions?.length > 0 && (
                <div className="border-l-4 border-blue-500 pl-4">
                  <h4 className="font-semibold mb-2">💭 Check Your Understanding</h4>
                  <ul className="list-decimal list-inside space-y-1 text-sm">
                    {parsedContent.teach_back_questions.map((q, idx) => (
                      <li key={idx}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}