import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAICall } from "@/hooks/useAICall";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { X, Plus, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function EducationMaterialEditor({ material, onClose, onSave }) {
  const [formData, setFormData] = useState({
    title: '',
    category: 'general_health',
    content: '',
    reading_level: 'middle_school',
    language: 'english',
    keywords: [],
    variables: [],
    is_published: true
  });
  const [newKeyword, setNewKeyword] = useState('');
  const ai = useAICall();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  useEffect(() => {
    if (material) {
      setFormData({
        title: material.title || '',
        category: material.category || 'general_health',
        content: material.content || '',
        reading_level: material.reading_level || 'middle_school',
        language: material.language || 'english',
        keywords: material.keywords || [],
        variables: material.variables || [],
        is_published: material.is_published !== false
      });
    }
  }, [material]);

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
        created_by: currentUser?.email,
        last_used_date: new Date().toISOString()
      };

      if (material?.id) {
        return base44.entities.EducationMaterial.update(material.id, payload);
      } else {
        return base44.entities.EducationMaterial.create(payload);
      }
    },
    onSuccess: () => {
      toast.success(material ? 'Material updated' : 'Material created');
      onSave();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to save material');
    }
  });

  const handleEnhanceWithAI = async () => {
    if (!formData.content) {
      toast.error('Please enter some content first');
      return;
    }

    try {
      const response = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `You are a patient education specialist. Enhance the following patient education content to be clear, empathetic, and easy to understand at a ${formData.reading_level} reading level. Keep variable placeholders like {{patient_name}} intact. Make it warm and supportive while maintaining medical accuracy.

Content to enhance:
${formData.content}

Return only the enhanced content, keeping all {{variable}} placeholders exactly as they are.`,
      });

      setFormData(prev => ({ ...prev, content: response }));
      toast.success('Content enhanced with AI');
    } catch {
      toast.error('Failed to enhance content');
    }
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !formData.keywords.includes(newKeyword.trim())) {
      setFormData(prev => ({
        ...prev,
        keywords: [...prev.keywords, newKeyword.trim()]
      }));
      setNewKeyword('');
    }
  };

  const removeKeyword = (keyword) => {
    setFormData(prev => ({
      ...prev,
      keywords: prev.keywords.filter(k => k !== keyword)
    }));
  };

  const detectVariables = () => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = [...formData.content.matchAll(regex)];
    const uniqueVars = [...new Set(matches.map(m => m[1].trim()))];
    
    const detectedVars = uniqueVars.map(varName => ({
      name: varName,
      description: varName.replace(/_/g, ' '),
      source: varName.includes('patient') || varName.includes('diagnosis') || varName.includes('medication') 
        ? 'patient_chart' 
        : 'manual_entry'
    }));

    setFormData(prev => ({ ...prev, variables: detectedVars }));
    toast.success(`Detected ${uniqueVars.length} variables`);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{material ? 'Edit' : 'Create'} Education Material</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Title */}
          <div>
            <Label>Title *</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="e.g., Diabetes Self-Care Guide"
            />
          </div>

          {/* Category & Reading Level */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category *</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="medication_management">Medication Management</SelectItem>
                  <SelectItem value="wound_care">Wound Care</SelectItem>
                  <SelectItem value="diabetes_education">Diabetes Education</SelectItem>
                  <SelectItem value="heart_failure">Heart Failure</SelectItem>
                  <SelectItem value="fall_prevention">Fall Prevention</SelectItem>
                  <SelectItem value="nutrition">Nutrition</SelectItem>
                  <SelectItem value="exercise_therapy">Exercise Therapy</SelectItem>
                  <SelectItem value="pain_management">Pain Management</SelectItem>
                  <SelectItem value="infection_control">Infection Control</SelectItem>
                  <SelectItem value="copd_management">COPD Management</SelectItem>
                  <SelectItem value="stroke_recovery">Stroke Recovery</SelectItem>
                  <SelectItem value="post_surgical_care">Post-Surgical Care</SelectItem>
                  <SelectItem value="general_health">General Health</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Reading Level</Label>
              <Select value={formData.reading_level} onValueChange={(value) => setFormData(prev => ({ ...prev, reading_level: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="elementary">Elementary (Grade 3-5)</SelectItem>
                  <SelectItem value="middle_school">Middle School (Grade 6-8)</SelectItem>
                  <SelectItem value="high_school">High School (Grade 9-12)</SelectItem>
                  <SelectItem value="college">College Level</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Content */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Content *</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={detectVariables}
                >
                  Detect Variables
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleEnhanceWithAI}
                  disabled={ai.loading}
                >
                  <Sparkles className="w-3 h-3 mr-1" />
                  {ai.loading ? 'Enhancing...' : 'Enhance with AI'}
                </Button>
              </div>
            </div>
            <Textarea
              value={formData.content}
              onChange={(e) => setFormData(prev => ({ ...prev, content: e.target.value }))}
              placeholder="Enter your content. Use {{variable_name}} for personalization, e.g., 'Dear {{patient_name}}, your {{diagnosis}} requires...'"
              rows={12}
              className="font-mono text-sm"
            />
            <p className="text-xs text-slate-500 mt-2">
              Tip: Use variables like {`{{patient_name}}`}, {`{{diagnosis}}`}, {`{{medications}}`} for automatic personalization
            </p>
          </div>

          {/* Variables */}
          {formData.variables.length > 0 && (
            <div>
              <Label>Detected Variables</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.variables.map((variable, idx) => (
                  <Badge key={idx} variant="outline" className="gap-1">
                    {`{{${variable.name}}}`}
                    <span className="text-xs text-slate-500">({variable.source})</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Keywords */}
          <div>
            <Label>Keywords (for search)</Label>
            <div className="flex gap-2 mb-2">
              <Input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="Add keyword..."
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
              />
              <Button type="button" onClick={addKeyword}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.keywords.map((keyword, idx) => (
                <Badge key={idx} className="gap-1">
                  {keyword}
                  <X 
                    className="w-3 h-3 cursor-pointer hover:text-red-600" 
                    onClick={() => removeKeyword(keyword)}
                  />
                </Badge>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              onClick={() => saveMutation.mutate(formData)}
              disabled={!formData.title || !formData.content || saveMutation.isPending}
            >
              <Save className="w-4 h-4 mr-2" />
              {saveMutation.isPending ? 'Saving...' : 'Save Material'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}