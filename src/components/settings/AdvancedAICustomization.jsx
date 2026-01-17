import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Wand2, Plus, Trash2, Save } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function AdvancedAICustomization({ currentUser }) {
  const queryClient = useQueryClient();
  const [customPrompts, setCustomPrompts] = useState([]);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');

  const { data: aiConfig } = useQuery({
    queryKey: ['aiConfig', currentUser?.email],
    queryFn: async () => {
      const configs = await base44.entities.AIConfiguration.filter({
        user_email: currentUser?.email
      });
      if (configs.length > 0 && configs[0].custom_prompts) {
        setCustomPrompts(configs[0].custom_prompts);
        return configs[0];
      }
      return null;
    },
    enabled: !!currentUser?.email
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (aiConfig) {
        return await base44.entities.AIConfiguration.update(aiConfig.id, data);
      } else {
        return await base44.entities.AIConfiguration.create({
          user_email: currentUser?.email,
          user_name: currentUser?.full_name,
          ...data
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['aiConfig']);
      toast.success('AI customization saved!');
    },
    onError: (error) => {
      toast.error('Failed to save customization');
      console.error(error);
    }
  });

  const addCustomPrompt = () => {
    if (!newPromptName.trim() || !newPromptContent.trim()) {
      toast.error('Please provide both name and content');
      return;
    }

    const newPrompt = {
      id: Date.now().toString(),
      name: newPromptName,
      content: newPromptContent,
      active: true,
      created_at: new Date().toISOString()
    };

    const updated = [...customPrompts, newPrompt];
    setCustomPrompts(updated);
    setNewPromptName('');
    setNewPromptContent('');
  };

  const removePrompt = (id) => {
    setCustomPrompts(customPrompts.filter(p => p.id !== id));
  };

  const togglePrompt = (id) => {
    setCustomPrompts(customPrompts.map(p => 
      p.id === id ? { ...p, active: !p.active } : p
    ));
  };

  const saveCustomization = () => {
    saveMutation.mutate({
      custom_prompts: customPrompts
    });
  };

  return (
    <Card className="border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-purple-600" />
          Advanced AI Customization
        </CardTitle>
        <p className="text-sm text-gray-600">
          Create custom AI prompts and rules for personalized documentation assistance
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Existing Custom Prompts */}
        {customPrompts.length > 0 && (
          <div>
            <h3 className="font-semibold mb-3">Your Custom Prompts</h3>
            <div className="space-y-3">
              {customPrompts.map((prompt) => (
                <div key={prompt.id} className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 border">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{prompt.name}</h4>
                      <Badge className={prompt.active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}>
                        {prompt.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => togglePrompt(prompt.id)}
                      >
                        {prompt.active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removePrompt(prompt.id)}
                        className="text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-white dark:bg-gray-800 p-3 rounded">
                    {prompt.content}
                  </p>
                  <p className="text-xs text-gray-500 mt-2">
                    Created: {new Date(prompt.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add New Prompt */}
        <div className="border-t pt-6">
          <h3 className="font-semibold mb-3">Add New Custom Prompt</h3>
          <div className="space-y-4">
            <div>
              <Label>Prompt Name</Label>
              <Input
                placeholder="e.g., 'Focus on wound assessment', 'Detailed medication review'"
                value={newPromptName}
                onChange={(e) => setNewPromptName(e.target.value)}
              />
            </div>
            
            <div>
              <Label>Prompt Content</Label>
              <Textarea
                placeholder="Enter your custom instructions for the AI...&#10;&#10;Example:&#10;When documenting wound care, always include:&#10;- Exact measurements (length x width x depth)&#10;- Wound bed appearance and percentage of each tissue type&#10;- Drainage amount, color, and odor&#10;- Periwound skin condition&#10;- Patient's pain level during dressing change"
                value={newPromptContent}
                onChange={(e) => setNewPromptContent(e.target.value)}
                className="h-32"
              />
              <p className="text-xs text-gray-600 mt-1">
                This prompt will be added to AI instructions when generating notes
              </p>
            </div>

            <Button onClick={addCustomPrompt} className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add Custom Prompt
            </Button>
          </div>
        </div>

        {/* Save Changes */}
        {customPrompts.length > 0 && (
          <Button
            onClick={saveCustomization}
            disabled={saveMutation.isPending}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Save All Customizations
          </Button>
        )}

        {/* Usage Tips */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">💡 Tips for Custom Prompts:</h4>
          <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
            <li>Be specific about what you want included in documentation</li>
            <li>Use bullet points for clarity</li>
            <li>Focus on clinical elements important to your specialty</li>
            <li>Reference specific compliance requirements</li>
            <li>Test and refine prompts based on AI output quality</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}