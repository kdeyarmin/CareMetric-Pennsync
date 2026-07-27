import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Search, Plus, BookOpen, Send, Eye, Edit, Copy, TrendingUp, Clock, Star
} from 'lucide-react';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/stat-card';
import EmptyState from '@/components/ui/empty-state';
import LoadingState from '@/components/ui/LoadingState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import EducationMaterialEditor from '../components/education/EducationMaterialEditor';
import PersonalizedMaterialSender from '../components/education/PersonalizedMaterialSender';
import MaterialPreview from '../components/education/MaterialPreview';
import { categoryLabels } from '@/components/education/educationCategories';
import { toast } from 'sonner';
import { ALL_ROWS } from '@/lib/queryLimits';

export default function EducationLibrary() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [editorMode, setEditorMode] = useState(null); // 'create', 'edit', 'view', 'send'

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: materials = [], isLoading } = useQuery({
    queryKey: ['educationMaterials'],
    queryFn: () => base44.entities.EducationMaterial.filter({ is_published: true }, '-last_used_date', ALL_ROWS),
    initialData: []
  });

  const { data: sentMaterials = [] } = useQuery({
    queryKey: ['sentEducationMaterials'],
    queryFn: () => base44.entities.SentEducationMaterial.list('-sent_date', 50),
    initialData: []
  });

  const _deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.EducationMaterial.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['educationMaterials'] });
      toast.success('Material deleted');
      setSelectedMaterial(null);
      setEditorMode(null);
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async (material) => {
      const duplicate = {
        ...material,
        title: `${material.title} (Copy)`,
        created_by: currentUser?.email,
        usage_count: 0,
        version: 1
      };
      delete duplicate.id;
      delete duplicate.created_date;
      delete duplicate.updated_date;
      return base44.entities.EducationMaterial.create(duplicate);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['educationMaterials'] });
      toast.success('Material duplicated');
    }
  });

  // Filter materials
  const filteredMaterials = useMemo(() => {
    let filtered = materials;

    if (categoryFilter !== 'all') {
      filtered = filtered.filter(m => m.category === categoryFilter);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(m => 
        m.title?.toLowerCase().includes(term) ||
        m.category?.toLowerCase().includes(term) ||
        m.keywords?.some(k => k.toLowerCase().includes(term))
      );
    }

    return filtered;
  }, [materials, categoryFilter, searchTerm]);

  // Calculate stats
  const stats = useMemo(() => {
    const totalMaterials = materials.length;
    const totalSent = sentMaterials.length;
    const recentSent = sentMaterials.filter(s => {
      const sentDate = new Date(s.sent_date);
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return sentDate >= weekAgo;
    }).length;
    // Copy before sort: materials is the React Query array; sorting in place mutates
    // the cache and reorders the grid that renders from the same array.
    const mostUsed = [...materials].sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))[0];

    return { totalMaterials, totalSent, recentSent, mostUsed };
  }, [materials, sentMaterials]);

  return (
    <PageContainer>
      <PageHeader
        icon={BookOpen}
        eyebrow="My Learning"
        title="Education Library"
        description="Create, manage, and send personalized education materials to patients"
        favoritePage="EducationLibrary"
      />

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard label="Total Materials" value={stats.totalMaterials} icon={BookOpen} tone="blue" />
        <StatCard label="Total Sent" value={stats.totalSent} icon={Send} tone="emerald" />
        <StatCard label="Sent This Week" value={stats.recentSent} icon={Clock} tone="navy" />
        <StatCard label="Most Popular" value={stats.mostUsed?.title || 'N/A'} icon={Star} tone="amber" />
      </div>

      <Tabs defaultValue="library" className="space-y-4">
        <TabsList>
          <TabsTrigger value="library">Material Library</TabsTrigger>
          <TabsTrigger value="sent">Sent Materials</TabsTrigger>
        </TabsList>

        {/* Library Tab */}
        <TabsContent value="library" className="space-y-4">
          {/* Search & Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input
                    placeholder="Search by title, category, or keywords..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-full md:w-64">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={() => { setEditorMode('create'); setSelectedMaterial(null); }}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create New
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Materials Grid */}
          {isLoading ? (
            <LoadingState label="Loading materials..." />
          ) : filteredMaterials.length === 0 ? (
            <EmptyState
              title="No materials found"
              icon={BookOpen}
              action={
                <Button onClick={() => { setEditorMode('create'); setSelectedMaterial(null); }}>
                  Create Your First Material
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredMaterials.map((material) => (
                <Card key={material.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <Badge className="bg-indigo-100 text-indigo-800">
                        {categoryLabels[material.category]}
                      </Badge>
                      {material.usage_count > 0 && (
                        <Badge variant="outline" className="gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {material.usage_count}
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-lg">{material.title}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {material.content?.substring(0, 100)}...
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {material.keywords?.slice(0, 3).map((keyword, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Button 
                        size="sm" 
                        onClick={() => {
                          setSelectedMaterial(material);
                          setEditorMode('send');
                        }}
                        className="flex-1"
                      >
                        <Send className="w-3 h-3 mr-1" />
                        Send
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          setSelectedMaterial(material);
                          setEditorMode('view');
                        }}
                      >
                        <Eye className="w-3 h-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          setSelectedMaterial(material);
                          setEditorMode('edit');
                        }}
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => duplicateMutation.mutate(material)}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Sent Materials Tab */}
        <TabsContent value="sent" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recently Sent Materials</CardTitle>
              <CardDescription>Track education materials delivered to patients</CardDescription>
            </CardHeader>
            <CardContent>
              {sentMaterials.length === 0 ? (
                <EmptyState title="No materials sent yet" icon={Send} />
              ) : (
                <div className="space-y-3">
                  {sentMaterials.map((sent) => (
                    <div key={sent.id} className="border rounded-lg p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold text-slate-900">{sent.material_title}</h4>
                          <p className="text-sm text-slate-600">
                            Patient: {sent.patient_name}
                          </p>
                        </div>
                        <Badge className={sent.patient_acknowledged ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}>
                          {sent.patient_acknowledged ? 'Acknowledged' : 'Pending'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>Sent by: {sent.sent_by}</span>
                        <span>•</span>
                        <span>{new Date(sent.sent_date).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>Via: {sent.delivery_method}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Editor/Viewer Modals */}
      {(editorMode === 'create' || editorMode === 'edit') && (
        <EducationMaterialEditor
          material={selectedMaterial}
          onClose={() => {
            setEditorMode(null);
            setSelectedMaterial(null);
          }}
          onSave={() => {
            queryClient.invalidateQueries({ queryKey: ['educationMaterials'] });
            setEditorMode(null);
            setSelectedMaterial(null);
          }}
        />
      )}

      {editorMode === 'view' && selectedMaterial && (
        <MaterialPreview
          material={selectedMaterial}
          onClose={() => {
            setEditorMode(null);
            setSelectedMaterial(null);
          }}
          onEdit={() => setEditorMode('edit')}
          onSend={() => setEditorMode('send')}
        />
      )}

      {editorMode === 'send' && selectedMaterial && (
        <PersonalizedMaterialSender
          material={selectedMaterial}
          onClose={() => {
            setEditorMode(null);
            setSelectedMaterial(null);
          }}
          onSent={() => {
            queryClient.invalidateQueries({ queryKey: ['sentEducationMaterials'] });
            queryClient.invalidateQueries({ queryKey: ['educationMaterials'] });
            setEditorMode(null);
            setSelectedMaterial(null);
          }}
        />
      )}
    </PageContainer>
  );
}