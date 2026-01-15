import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Edit2, Trash2, Plus, ArrowLeft } from 'lucide-react';
import TemplateBuilder from '../components/documents/TemplateBuilder';
import EmptyState from '../components/ui/EmptyState';
import PullToRefresh from '../components/mobile/PullToRefresh';
import { createPageUrl } from '@/utils';
import { Link } from 'react-router-dom';

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
      const all = await base44.entities.DocumentTemplate.list('-created_date', 100);
      return all.filter(t => t.created_by === currentUser?.email || (!t.is_system_template && !t.created_by));
    },
    enabled: !!currentUser?.email
  });

  const { data: systemTemplates = [] } = useQuery({
    queryKey: ['systemTemplates'],
    queryFn: async () => {
      const all = await base44.entities.DocumentTemplate.list('-created_date', 100);
      return all.filter(t => t.is_system_template);
    }
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

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">{template.category || 'Uncategorized'}</span>
          {!isEditable && (
            <span className="text-slate-400 italic">System Template</span>
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

            <Tabs defaultValue="my-templates" className="space-y-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="my-templates">
                  My Templates ({userTemplates.length})
                </TabsTrigger>
                <TabsTrigger value="system-templates">
                  System Templates ({systemTemplates.length})
                </TabsTrigger>
              </TabsList>

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

              <TabsContent value="system-templates">
                {systemTemplates.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    No system templates available
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {systemTemplates.map((template) => (
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

            <TemplateBuilder
              initialTemplate={selectedTemplate}
              onSave={(data) => saveTemplateMutation.mutate(data)}
              saving={saveTemplateMutation.isPending}
            />
          </>
        )}
      </div>
    </PullToRefresh>
  );
}