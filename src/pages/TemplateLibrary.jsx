import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Edit2, Trash2, Plus, ArrowLeft, Sparkles } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';
import PullToRefresh from '../components/mobile/PullToRefresh';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import AITemplateGenerator from '../components/templates/AITemplateGenerator';
import PrebuiltTemplateLibrary from '../components/templates/PrebuiltTemplateLibrary';
import CustomTemplateEditor from '../components/templates/CustomTemplateEditor';

export default function TemplateLibrary() {
  const [step, setStep] = useState('list'); // list, create, edit
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: userTemplates = [] } = useQuery({
    queryKey: ['userTemplates', currentUser?.email],
    queryFn: async () => {
      const all = await base44.entities.DocumentTemplate.list('-created_date', 200);
      return all.filter(t => t.created_by === currentUser?.email);
    },
    enabled: !!currentUser?.email
  });

  const { data: publicTemplates = [] } = useQuery({
    queryKey: ['publicTemplates'],
    queryFn: async () => {
      const all = await base44.entities.DocumentTemplate.list('-usage_count', 100);
      return all.filter(t => t.is_public && t.created_by !== currentUser?.email);
    },
    enabled: !!currentUser?.email
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (data) => {
      if (selectedTemplate?.id) {
        return base44.entities.DocumentTemplate.update(selectedTemplate.id, data);
      } else {
        return base44.entities.DocumentTemplate.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userTemplates'] });
      setStep('list');
      setSelectedTemplate(null);
    }
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (templateId) => base44.entities.DocumentTemplate.delete(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userTemplates'] });
    }
  });

  const TemplateCard = ({ template, onEdit, onDelete, isEditable }) => (
    <Card
      className="hover:shadow-lg transition-shadow cursor-pointer"
      onClick={onEdit}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {template.template_name}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {template.description}
            </p>
          </div>
          {isEditable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Delete this template?')) {
                  onDelete(template.id);
                }
              }}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {template.category?.replace(/_/g, ' ') || 'Uncategorized'}
          </Badge>
          {template.ai_generated && (
            <Badge className="bg-purple-600 text-xs">
              <Sparkles className="w-3 h-3 mr-1" />
              AI
            </Badge>
          )}
          {template.usage_count > 0 && (
            <Badge variant="outline" className="text-xs">
              Used {template.usage_count}x
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <PullToRefresh onRefresh={async () => {
      await queryClient.invalidateQueries({ queryKey: ['userTemplates', 'systemTemplates'] });
    }}>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        {step === 'list' ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <FileText className="w-8 h-8" />
                  Document Templates
                </h1>
                <p className="text-slate-600 dark:text-slate-400 mt-1">
                  Create and manage custom document templates for your patients.
                </p>
              </div>
              <Button
                onClick={() => {
                  setSelectedTemplate(null);
                  setStep('create');
                }}
                className="bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700 text-slate-900 dark:text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Template
              </Button>
            </div>

            <Tabs defaultValue="prebuilt" className="space-y-6">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="prebuilt">
                  📚 Pre-built
                </TabsTrigger>
                <TabsTrigger value="my-templates">
                  📝 My Templates ({userTemplates.length})
                </TabsTrigger>
                <TabsTrigger value="public">
                  🌐 Shared ({publicTemplates.length})
                </TabsTrigger>
                <TabsTrigger value="ai-generator">
                  <Sparkles className="w-4 h-4 mr-1" />
                  AI Generator
                </TabsTrigger>
              </TabsList>

              <TabsContent value="prebuilt">
                <PrebuiltTemplateLibrary
                  onUseTemplate={() => {
                    queryClient.invalidateQueries({ queryKey: ['userTemplates'] });
                  }}
                />
              </TabsContent>

              <TabsContent value="ai-generator">
                <AITemplateGenerator
                  onTemplateGenerated={() => {
                    queryClient.invalidateQueries({ queryKey: ['userTemplates'] });
                    toast.success("Template saved! Check 'My Templates' tab.");
                  }}
                />
              </TabsContent>

              <TabsContent value="public">
                {publicTemplates.length === 0 ? (
                  <Card>
                    <CardContent className="p-12 text-center">
                      <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-600">No shared templates available</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {publicTemplates.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        onEdit={() => {
                          setSelectedTemplate(template);
                          setStep('edit');
                        }}
                        isEditable={false}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="my-templates">
                {userTemplates.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No Custom Templates"
                    description="Create your first template to get started."
                    actions={[
                      {
                        label: 'Create Template',
                        onClick: () => setStep('create')
                      }
                    ]}
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {userTemplates.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        onEdit={() => {
                          setSelectedTemplate(template);
                          setStep('edit');
                        }}
                        onDelete={(id) => deleteTemplateMutation.mutate(id)}
                        isEditable={true}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

            </Tabs>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <Button
                variant="ghost"
                onClick={() => {
                  setStep('list');
                  setSelectedTemplate(null);
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {step === 'create' ? 'Create New Template' : 'Edit Template'}
              </h1>
            </div>

            <CustomTemplateEditor
              initialTemplate={selectedTemplate}
              onSave={(data) => saveTemplateMutation.mutate(data)}
              onCancel={() => {
                setStep('list');
                setSelectedTemplate(null);
              }}
            />
          </>
        )}
      </div>
    </PullToRefresh>
  );
}