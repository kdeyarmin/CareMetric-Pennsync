import { lazy, Suspense, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Plus, Edit2, Trash2, FileText, FileType } from 'lucide-react';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import { isSuperAdmin } from '@/lib/superAdmin';

const PDFTemplateLibrary = lazy(() => import('@/components/hub-tabs/PDFTemplateLibrary'));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so the retired PDF Template Library page redirects to its tab.
const TAB_KEYS = ['templates', 'pdf'];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function TemplateManagement() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'consent',
    content: '',
  });

  const { data: currentUser, isLoading: isUserLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const isAdmin = currentUser?.role === 'admin' || isSuperAdmin(currentUser);
  // The document-template CRUD tab is admin-only; the PDF Templates tab stays
  // open to everyone (the retired /PDFTemplateLibrary route was non-admin), so
  // non-admins land on — and are limited to — the PDF tab.
  const defaultTab = isAdmin ? 'templates' : 'pdf';
  const validTabKeys = isAdmin ? ['templates', 'pdf'] : ['pdf'];

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  // Until auth resolves, honor any known tab; once loaded, fall back to the
  // role-appropriate default (admins → templates, others → pdf).
  const activeTab = isUserLoading
    ? (TAB_KEYS.includes(requestedTab) ? requestedTab : 'templates')
    : (validTabKeys.includes(requestedTab) ? requestedTab : defaultTab);

  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and the
  // retired PDF Template Library page deep-links correctly. The role default
  // stays a clean /TemplateManagement with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === defaultTab ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant ?tab= once auth resolves and
  // the param matches the role default.
  useEffect(() => {
    if (!isUserLoading && requestedTab !== null && activeTab === defaultTab) {
      setSearchParams({}, { replace: true });
    }
  }, [isUserLoading, requestedTab, activeTab, defaultTab, setSearchParams]);

  // Fetch templates
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => base44.entities.DocumentTemplate.list('-created_date', 100),
  });

  // Create/update template
  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (editingTemplate) {
        return base44.entities.DocumentTemplate.update(editingTemplate.id, data);
      }
      return base44.entities.DocumentTemplate.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setShowForm(false);
      setEditingTemplate(null);
      setFormData({ name: '', description: '', category: 'consent', content: '' });
    },
  });

  // Delete template
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.DocumentTemplate.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });

  const handleSave = () => {
    if (!formData.name || !formData.content) return;

    // Extract placeholders from content
    const placeholderMatches = formData.content.match(/{{(\w+)}}/g) || [];
    const uniquePlaceholders = [...new Set(placeholderMatches.map((m) => m.slice(2, -2)))];
    const placeholders = uniquePlaceholders.map((key) => ({
      key,
      label: key.replace(/_/g, ' ').toUpperCase(),
      required: true,
    }));

    saveMutation.mutate({
      ...formData,
      placeholders,
    });
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description,
      category: template.category,
      content: template.content,
    });
    setShowForm(true);
  };

  const handleReset = () => {
    setShowForm(false);
    setEditingTemplate(null);
    setFormData({ name: '', description: '', category: 'consent', content: '' });
  };

  return (
    <PageContainer>
      <PageHeader
        icon={FileText}
        eyebrow="Documentation"
        title="Template Management"
        description="Create and manage document templates for patient records"
        favoritePage="TemplateManagement"
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            {isAdmin && (
              <TabsTrigger value="templates" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                <FileText className="h-4 w-4 mr-2" />
                Document Templates
              </TabsTrigger>
            )}
            <TabsTrigger value="pdf" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileType className="h-4 w-4 mr-2" />
              PDF Templates
            </TabsTrigger>
          </TabsList>
        </div>

        {isAdmin && (
        <TabsContent value="templates" className="space-y-4 sm:space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
      <div className="flex justify-end">
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" /> New Template
        </Button>
      </div>

      {showForm && (
        <Card className="p-6 space-y-4">
          <h2 className="text-xl font-semibold">
            {editingTemplate ? 'Edit Template' : 'Create New Template'}
          </h2>
          <Input
            placeholder="Template Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Input
            placeholder="Description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <select
            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
          >
            <option value="consent">Consent</option>
            <option value="discharge">Discharge</option>
            <option value="admission">Admission</option>
            <option value="assessment">Assessment</option>
            <option value="plan">Care Plan</option>
            <option value="education">Education</option>
            <option value="other">Other</option>
          </select>
          <Textarea
            placeholder="Document Content (use {{placeholder_name}} for dynamic fields)"
            value={formData.content}
            onChange={(e) => setFormData({ ...formData, content: e.target.value })}
            className="min-h-64"
          />
          <div className="text-sm text-slate-600">
            <p className="font-semibold mb-2">Available Placeholders:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>{"{{patient_name}}"} - Full name</li>
              <li>{"{{patient_first_name}}"}, {"{{patient_last_name}}"}</li>
              <li>{"{{patient_date_of_birth}}"}, {"{{patient_email}}"}, {"{{patient_phone}}"}</li>
              <li>{"{{patient_address}}"}, {"{{patient_medical_record_number}}"}</li>
              <li>{"{{date}}"} (YYYY-MM-DD), {"{{today}}"} (formatted)</li>
            </ul>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save
            </Button>
            <Button variant="outline" onClick={handleReset}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4">
        {templates.map((template) => (
          <Card key={template.id} className="p-4">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <h3 className="font-semibold text-lg">{template.name}</h3>
                <p className="text-sm text-slate-600">{template.description}</p>
                <div className="mt-2 flex gap-2">
                  <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">
                    {template.category}
                  </span>
                  <span className="text-xs text-slate-500">
                    {template.placeholders?.length || 0} placeholders
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleEdit(template)}
                >
                  <Edit2 className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => deleteMutation.mutate(template.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {templates.length === 0 && !showForm && (
        <Card className="p-8 text-center text-slate-500">
          No templates yet. Create one to get started.
        </Card>
      )}
            </>
          )}
        </TabsContent>
        )}

        <TabsContent value="pdf">
          <Suspense fallback={tabLoader}>
            <PDFTemplateLibrary />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}