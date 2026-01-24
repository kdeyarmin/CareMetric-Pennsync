import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Copy, Star, TrendingUp, Search } from "lucide-react";

export default function SharedPhraseLibrary({ onInsertPhrase }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [formData, setFormData] = useState({
    phrase_name: "",
    phrase_content: "",
    category: "",
    tags: ""
  });

  const { data: phrases = [] } = useQuery({
    queryKey: ['sharedPhrases'],
    queryFn: () => base44.entities.SharedPhraseLibrary.list('-usage_count')
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const createPhraseMutation = useMutation({
    mutationFn: (data) => base44.entities.SharedPhraseLibrary.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sharedPhrases'] });
      toast.success('Phrase added to library');
      resetForm();
    }
  });

  const incrementUsageMutation = useMutation({
    mutationFn: (phrase) => base44.entities.SharedPhraseLibrary.update(phrase.id, {
      usage_count: (phrase.usage_count || 0) + 1
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sharedPhrases'] });
    }
  });

  const resetForm = () => {
    setFormData({
      phrase_name: "",
      phrase_content: "",
      category: "",
      tags: ""
    });
    setShowForm(false);
  };

  const handleSubmit = () => {
    const data = {
      ...formData,
      tags: formData.tags.split(',').map(s => s.trim()).filter(Boolean),
      created_by_role: currentUser?.role || 'user'
    };
    createPhraseMutation.mutate(data);
  };

  const handleInsertPhrase = (phrase) => {
    incrementUsageMutation.mutate(phrase);
    if (onInsertPhrase) {
      onInsertPhrase(phrase.phrase_content);
    }
  };

  const filteredPhrases = phrases.filter(phrase => {
    const matchesCategory = categoryFilter === "all" || phrase.category === categoryFilter;
    const matchesSearch = !searchTerm || 
      phrase.phrase_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      phrase.phrase_content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      phrase.tags?.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const bestPractices = phrases.filter(p => p.is_best_practice);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Shared Phrase Library</h3>
          <p className="text-sm text-slate-600">Agency-wide approved phrases and best practices</p>
        </div>
        {currentUser?.role === 'admin' && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Add Phrase
          </Button>
        )}
      </div>

      {showForm && currentUser?.role === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle>Create Shared Phrase</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Input
                placeholder="Phrase name"
                value={formData.phrase_name}
                onChange={(e) => setFormData({ ...formData, phrase_name: e.target.value })}
              />
            </div>
            <div>
              <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="assessment">Assessment</SelectItem>
                  <SelectItem value="intervention">Intervention</SelectItem>
                  <SelectItem value="education">Patient Education</SelectItem>
                  <SelectItem value="homebound">Homebound Status</SelectItem>
                  <SelectItem value="skilled_need">Skilled Need</SelectItem>
                  <SelectItem value="vital_signs">Vital Signs</SelectItem>
                  <SelectItem value="safety">Safety</SelectItem>
                  <SelectItem value="medication">Medication</SelectItem>
                  <SelectItem value="wound_care">Wound Care</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Textarea
                placeholder="Phrase content"
                value={formData.phrase_content}
                onChange={(e) => setFormData({ ...formData, phrase_content: e.target.value })}
                rows={4}
              />
            </div>
            <div>
              <Input
                placeholder="Tags (comma-separated)"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!formData.phrase_name || !formData.phrase_content}>
                Create Phrase
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search and Filter */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search phrases..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="assessment">Assessment</SelectItem>
            <SelectItem value="intervention">Intervention</SelectItem>
            <SelectItem value="education">Patient Education</SelectItem>
            <SelectItem value="homebound">Homebound Status</SelectItem>
            <SelectItem value="skilled_need">Skilled Need</SelectItem>
            <SelectItem value="vital_signs">Vital Signs</SelectItem>
            <SelectItem value="safety">Safety</SelectItem>
            <SelectItem value="medication">Medication</SelectItem>
            <SelectItem value="wound_care">Wound Care</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Best Practices Section */}
      {bestPractices.length > 0 && (
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="w-5 h-5 text-blue-600" />
              Best Practices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bestPractices.map((phrase) => (
              <div key={phrase.id} className="p-3 bg-white rounded-lg border border-blue-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">{phrase.phrase_name}</span>
                      <Badge>{phrase.category}</Badge>
                      <Badge variant="outline" className="text-xs">
                        <TrendingUp className="w-3 h-3 mr-1" />
                        {phrase.usage_count || 0}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-700">{phrase.phrase_content}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleInsertPhrase(phrase)}
                    className="flex-shrink-0"
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Use
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* All Phrases */}
      <div className="space-y-2">
        {filteredPhrases.map((phrase) => (
          <Card key={phrase.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold">{phrase.phrase_name}</span>
                    <Badge variant="outline">{phrase.category}</Badge>
                    {phrase.is_best_practice && (
                      <Badge className="bg-blue-600">
                        <Star className="w-3 h-3 mr-1" />
                        Best Practice
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      {phrase.usage_count || 0} uses
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-700">{phrase.phrase_content}</p>
                  {phrase.tags && phrase.tags.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {phrase.tags.map((tag, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => handleInsertPhrase(phrase)}
                  variant="outline"
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Use
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredPhrases.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            No phrases found matching your search
          </CardContent>
        </Card>
      )}
    </div>
  );
}