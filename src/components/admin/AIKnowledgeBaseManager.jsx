import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Brain, Plus, Search, TrendingUp, CheckCircle2, X, Edit } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export default function AIKnowledgeBaseManager() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);

  const [formData, setFormData] = useState({
    title: '',
    category: 'clinical_documentation',
    provider_type: 'all',
    care_setting: 'all',
    visit_type: 'all',
    diagnosis: 'all',
    content: '',
    example_note: '',
    tags: ''
  });

  const { data: knowledgeBase = [] } = useQuery({
    queryKey: ['knowledgeBase'],
    queryFn: () => base44.entities.AIKnowledgeBase.list('-effectiveness_score', 500)
  });

  const { data: learningPatterns = [] } = useQuery({
    queryKey: ['learningPatterns'],
    queryFn: () => base44.entities.AILearningPattern.list('-confidence', 200)
  });

  const createEntryMutation = useMutation({
    mutationFn: (data) => base44.entities.AIKnowledgeBase.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledgeBase'] });
      setShowAddDialog(false);
      resetForm();
    }
  });

  const updateEntryMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AIKnowledgeBase.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledgeBase'] });
      setEditingEntry(null);
      resetForm();
    }
  });

  const deleteEntryMutation = useMutation({
    mutationFn: (id) => base44.entities.AIKnowledgeBase.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['knowledgeBase'] })
  });

  const promotePatternMutation = useMutation({
    mutationFn: async (pattern) => {
      await base44.entities.AIKnowledgeBase.create({
        title: `Learned Pattern: ${pattern.pattern_rule}`,
        category: pattern.pattern_type === 'compliance_fix' ? 'compliance' : 'best_practice',
        provider_type: pattern.provider_type || 'all',
        care_setting: pattern.context?.care_setting || 'all',
        visit_type: pattern.context?.visit_type || 'all',
        diagnosis: pattern.context?.diagnosis || 'all',
        content: pattern.pattern_rule,
        example_note: pattern.corrected_text || '',
        tags: [pattern.pattern_type, 'learned'],
        source: 'learned_from_edits',
        effectiveness_score: pattern.confidence || 60
      });
      
      // Update pattern to global
      await base44.entities.AILearningPattern.update(pattern.id, {
        provider_email: 'global'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledgeBase'] });
      queryClient.invalidateQueries({ queryKey: ['learningPatterns'] });
    }
  });

  const resetForm = () => {
    setFormData({
      title: '',
      category: 'clinical_documentation',
      provider_type: 'all',
      care_setting: 'all',
      visit_type: 'all',
      diagnosis: 'all',
      content: '',
      example_note: '',
      tags: ''
    });
  };

  const handleSubmit = () => {
    const data = {
      ...formData,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      source: 'admin_curated'
    };

    if (editingEntry) {
      updateEntryMutation.mutate({ id: editingEntry.id, data });
    } else {
      createEntryMutation.mutate(data);
    }
  };

  const filteredKnowledge = knowledgeBase.filter(kb => {
    const matchesSearch = kb.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         kb.content?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'all' || kb.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const topPatterns = learningPatterns
    .filter(p => p.confidence > 70 && p.occurrences > 2)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-purple-600" />
            AI Knowledge Base & Learning Manager
          </CardTitle>
        </CardHeader>
      <CardContent className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{knowledgeBase.length}</p>
              <p className="text-xs text-gray-600">Knowledge Entries</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{learningPatterns.length}</p>
              <p className="text-xs text-gray-600">Learned Patterns</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">
                {knowledgeBase.reduce((sum, kb) => sum + (kb.usage_count || 0), 0)}
              </p>
              <p className="text-xs text-gray-600">Total Uses</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{topPatterns.length}</p>
              <p className="text-xs text-gray-600">High-Confidence Patterns</p>
            </CardContent>
          </Card>
        </div>

        {/* Promote Patterns Section */}
        {topPatterns.length > 0 && (
          <Card className="border-orange-300 bg-orange-50">
            <CardHeader>
              <CardTitle className="text-sm">🎯 Promote to Agency Best Practices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {topPatterns.map(pattern => (
                <div key={pattern.id} className="flex items-start justify-between gap-3 bg-white p-3 rounded border">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{pattern.pattern_rule}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className="text-xs">{pattern.pattern_type}</Badge>
                      <span className="text-xs text-gray-500">
                        {pattern.occurrences} occurrences • {pattern.confidence}% confidence
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => promotePatternMutation.mutate(pattern)}
                    disabled={promotePatternMutation.isPending}
                  >
                    <TrendingUp className="w-4 h-4 mr-1" />
                    Promote
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Search and Filter */}
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              placeholder="Search knowledge base..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="clinical_documentation">Clinical Documentation</SelectItem>
              <SelectItem value="compliance">Compliance</SelectItem>
              <SelectItem value="best_practice">Best Practice</SelectItem>
              <SelectItem value="terminology">Terminology</SelectItem>
              <SelectItem value="care_plan">Care Plan</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600">
                <Plus className="w-4 h-4 mr-2" />
                Add Entry
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Knowledge Base Entry</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Title</Label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Category</Label>
                    <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="clinical_documentation">Clinical Documentation</SelectItem>
                        <SelectItem value="compliance">Compliance</SelectItem>
                        <SelectItem value="best_practice">Best Practice</SelectItem>
                        <SelectItem value="terminology">Terminology</SelectItem>
                        <SelectItem value="care_plan">Care Plan</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label>Provider Type</Label>
                    <Input
                      value={formData.provider_type}
                      onChange={(e) => setFormData({ ...formData, provider_type: e.target.value })}
                      placeholder="e.g., RN, all"
                    />
                  </div>
                </div>

                <div>
                  <Label>Content / Best Practice</Label>
                  <Textarea
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                    rows={4}
                  />
                </div>

                <div>
                  <Label>Example Note (Optional)</Label>
                  <Textarea
                    value={formData.example_note}
                    onChange={(e) => setFormData({ ...formData, example_note: e.target.value })}
                    rows={3}
                  />
                </div>

                <div>
                  <Label>Tags (comma-separated)</Label>
                  <Input
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    placeholder="homebound, skilled, assessment"
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSubmit} className="flex-1">
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    {editingEntry ? 'Update' : 'Create'} Entry
                  </Button>
                  <Button variant="outline" onClick={() => { setShowAddDialog(false); resetForm(); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Knowledge Base List */}
        <div className="space-y-3">
          {filteredKnowledge.map(kb => (
            <Card key={kb.id} className="border-l-4 border-l-blue-500">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h4 className="font-semibold text-sm mb-1">{kb.title}</h4>
                    <p className="text-xs text-gray-600 mb-2">{kb.content}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="text-xs">{kb.category}</Badge>
                      <Badge variant="outline" className="text-xs">{kb.provider_type}</Badge>
                      <Badge variant="outline" className="text-xs">{kb.source}</Badge>
                      {kb.compliance_score && (
                        <span className="text-xs text-green-600">
                          Compliance: {kb.compliance_score}%
                        </span>
                      )}
                      <span className="text-xs text-gray-500">Used {kb.usage_count || 0} times</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingEntry(kb);
                        setFormData({
                          title: kb.title,
                          category: kb.category,
                          provider_type: kb.provider_type,
                          care_setting: kb.care_setting,
                          visit_type: kb.visit_type || 'all',
                          diagnosis: kb.diagnosis || 'all',
                          content: kb.content,
                          example_note: kb.example_note || '',
                          tags: (kb.tags || []).join(', ')
                        });
                        setShowAddDialog(true);
                      }}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteEntryMutation.mutate(kb.id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
    </div>
  );
}