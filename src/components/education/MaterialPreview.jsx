import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Edit, Send, X } from 'lucide-react';

export default function MaterialPreview({ material, onClose, onEdit, onSend }) {
  const categoryLabels = {
    medication_management: 'Medication Management',
    wound_care: 'Wound Care',
    diabetes_education: 'Diabetes Education',
    heart_failure: 'Heart Failure',
    fall_prevention: 'Fall Prevention',
    nutrition: 'Nutrition',
    exercise_therapy: 'Exercise Therapy',
    pain_management: 'Pain Management',
    infection_control: 'Infection Control',
    copd_management: 'COPD Management',
    stroke_recovery: 'Stroke Recovery',
    post_surgical_care: 'Post-Surgical Care',
    general_health: 'General Health'
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-2xl mb-2">{material.title}</DialogTitle>
              <div className="flex gap-2 flex-wrap">
                <Badge className="bg-indigo-100 text-indigo-800">
                  {categoryLabels[material.category]}
                </Badge>
                <Badge variant="outline">
                  {material.reading_level?.replace('_', ' ')}
                </Badge>
                {material.usage_count > 0 && (
                  <Badge variant="outline">
                    Used {material.usage_count} times
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Keywords */}
          {material.keywords?.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Keywords:</p>
              <div className="flex flex-wrap gap-2">
                {material.keywords.map((keyword, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {keyword}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <Card className="bg-white">
            <CardContent className="pt-6">
              <div className="prose prose-sm max-w-none">
                <div className="whitespace-pre-wrap text-slate-800">
                  {material.content}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Variables Info */}
          {material.variables?.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Personalization Variables:</p>
              <div className="grid grid-cols-2 gap-2">
                {material.variables.map((variable, idx) => (
                  <div key={idx} className="text-sm p-2 bg-slate-50 rounded border">
                    <code className="text-xs text-blue-600">{`{{${variable.name}}}`}</code>
                    <p className="text-xs text-slate-600 mt-1">{variable.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm text-slate-600 pt-4 border-t">
            <div>
              <p className="font-medium">Created by:</p>
              <p>{material.created_by || 'Unknown'}</p>
            </div>
            <div>
              <p className="font-medium">Last used:</p>
              <p>
                {material.last_used_date 
                  ? new Date(material.last_used_date).toLocaleDateString()
                  : 'Never'
                }
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
            <Button variant="outline" onClick={onEdit}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
            <Button onClick={onSend}>
              <Send className="w-4 h-4 mr-2" />
              Send to Patient
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}