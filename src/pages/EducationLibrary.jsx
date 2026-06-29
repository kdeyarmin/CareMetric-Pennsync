import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Search, Plus, BookOpen, Send, Eye, Edit, Copy, TrendingUp, Clock, FileText, Star
} from 'lucide-react';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import EducationMaterialEditor from '../components/education/EducationMaterialEditor';
import PersonalizedMaterialSender from '../components/education/PersonalizedMaterialSender';
import MaterialPreview from '../components/education/MaterialPreview';
import { toast } from 'sonner';

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
    queryFn: () => base44.entities.EducationMaterial.filter({ is_published: true }, '-last_used_date'),
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
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <BookOpen className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{stats.totalMaterials}</p>
                <p className="text-sm text-slate-600">Total Materials</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <Send className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{stats.totalSent}</p>
                <p className="text-sm text-slate-600">Total Sent</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-navy-100 rounded-lg">
                <Clock className="w-5 h-5 text-navy-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{stats.recentSent}</p>
                <p className="text-sm text-slate-600">Sent This Week</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-lg">
                <Star className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {stats.mostUsed?.title || 'N/A'}
                </p>
                <p className="text-xs text-slate-600">Most Popular</p>
              </div>
            </div>
          </CardContent>
        </Card>
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
            <Card>
              <CardContent className="py-12 text-center text-slate-500">
                Loading materials...
              </CardContent>
            </Card>
          ) : filteredMaterials.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No materials found</p>
                <Button 
                  onClick={() => { setEditorMode('create'); setSelectedMaterial(null); }}
                  className="mt-4"
                >
                  Create Your First Material
                </Button>
              </CardContent>
            </Card>
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
                <div className="text-center py-8 text-slate-500">
                  <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p>No materials sent yet</p>
                </div>
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