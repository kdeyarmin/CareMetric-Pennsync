import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export default function PersonalizedEducationGenerator({ patientId, open, onOpenChange, onSuccess }) {
  const [formData, setFormData] = useState({
    topic: '',
    language: 'en',
    reading_level: 'simple'
  });

  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: async (data) => {
      const response = await base44.functions.invoke('generatePersonalizedEducation', {
        patient_id: patientId,
        ...data
      });
      return response;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['educationMaterials'] });
      toast.success('Education material generated successfully');
      onOpenChange(false);
      if (onSuccess) onSuccess(result);
      setFormData({ topic: '', language: 'en', reading_level: 'simple' });
    },
    onError: (error) => {
      toast.error(`Failed to generate: ${error.message}`);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    generateMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generate Personalized Education
          </DialogTitle>
          <DialogDescription>
            AI will create customized educational content based on the patient's specific conditions
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Topic *</Label>
            <Input
              value={formData.topic}
              onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
              placeholder="e.g., Managing Diabetes at Home, Fall Prevention Tips"
              required
            />
          </div>

          <div>
            <Label>Language</Label>
            <Select
              value={formData.language}
              onValueChange={(value) => setFormData({ ...formData, language: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">🇺🇸 English</SelectItem>
                <SelectItem value="es">🇪🇸 Spanish</SelectItem>
                <SelectItem value="zh">🇨🇳 Chinese</SelectItem>
                <SelectItem value="ar">🇸🇦 Arabic</SelectItem>
                <SelectItem value="fr">🇫🇷 French</SelectItem>
                <SelectItem value="de">🇩🇪 German</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Reading Level</Label>
            <Select
              value={formData.reading_level}
              onValueChange={(value) => setFormData({ ...formData, reading_level: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simple">Simple (6th-8th grade)</SelectItem>
                <SelectItem value="intermediate">Intermediate (9th-12th grade)</SelectItem>
                <SelectItem value="advanced">Advanced (College level)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={generateMutation.isPending}>
              {generateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}