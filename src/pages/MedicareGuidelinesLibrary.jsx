import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  BookOpen,
  Plus,
  ExternalLink,
  Calendar,
  Tag,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Sparkles
} from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function MedicareGuidelinesLibrary() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedGuideline, setSelectedGuideline] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [useSemanticSearch, setUseSemanticSearch] = useState(false);
  const [semanticResults, setSemanticResults] = useState(null);
  const [searchInterpretation, setSearchInterpretation] = useState("");

  // Form state for adding new guideline
  const [newGuidelineUrl, setNewGuidelineUrl] = useState("");
  const [newGuidelineCategory, setNewGuidelineCategory] = useState("clinical_documentation");
  const [newGuidelineSubcategory, setNewGuidelineSubcategory] = useState("");
  const [newGuidelineKeywords, setNewGuidelineKeywords] = useState("");
  const [newGuidelineChapter, setNewGuidelineChapter] = useState("");
  const [newGuidelineCitation, setNewGuidelineCitation] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  const { data: guidelines = [], isLoading } = useQuery({
    queryKey: ['medicareGuidelines'],
    queryFn: () => base44.entities.MedicareGuideline.filter({ is_active: true }, '-last_fetched_date'),
    initialData: [],
  });

  const fetchGuidelineMutation = useMutation({
    mutationFn: async (data) => {
      const response = await base44.functions.invoke('fetchMedicareGuideline', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicareGuidelines'] });
      setAddDialogOpen(false);
      // Reset form
      setNewGuidelineUrl("");
      setNewGuidelineCategory("clinical_documentation");
      setNewGuidelineSubcategory("");
      setNewGuidelineKeywords("");
      setNewGuidelineChapter("");
      setNewGuidelineCitation("");
    },
  });

  const deleteGuidelineMutation = useMutation({
    mutationFn: (id) => base44.entities.MedicareGuideline.update(id, { is_active: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicareGuidelines'] });
      setDialogOpen(false);
      setSelectedGuideline(null);
    },
  });

  const autoFetchMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('autoFetchCMSGuidelines', {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['medicareGuidelines'] });
    },
  });

  const semanticSearchMutation = useMutation({
    mutationFn: async (query) => {
      const response = await base44.functions.invoke('semanticSearchGuidelines', { query });
      return response.data;
    },
    onSuccess: (data) => {
      setSemanticResults(data.results);
      setSearchInterpretation(data.interpretation || '');
    },
  });

  const handleAddGuideline = () => {
    const keywordsArray = newGuidelineKeywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k);

    fetchGuidelineMutation.mutate({
      url: newGuidelineUrl,
      category: newGuidelineCategory,
      subcategory: newGuidelineSubcategory || null,
      keywords: keywordsArray,
      cms_manual_chapter: newGuidelineChapter || null,
      regulatory_citation: newGuidelineCitation || null
    });
  };

  const handleSearch = () => {
    if (useSemanticSearch && searchTerm.trim()) {
      semanticSearchMutation.mutate(searchTerm);
    } else {
      setSemanticResults(null);
      setSearchInterpretation('');
    }
  };

  const filteredGuidelines = useSemanticSearch && semanticResults 
    ? semanticResults.filter(guideline => 
        categoryFilter === "all" || guideline.category === categoryFilter
      )
    : guidelines.filter(guideline => {
        const matchesSearch = searchTerm === "" || 
          guideline.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          guideline.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          guideline.keywords?.some(k => k.toLowerCase().includes(searchTerm.toLowerCase()));
        
        const matchesCategory = categoryFilter === "all" || guideline.category === categoryFilter;
        
        return matchesSearch && matchesCategory;
      });

  const getCategoryLabel = (category) => {
    const labels = {
      oasis: "OASIS",
      medicare_cop: "Medicare CoP",
      billing_reimbursement: "Billing & Reimbursement",
      clinical_documentation: "Clinical Documentation",
      home_health_regulations: "Home Health Regulations",
      hospice_regulations: "Hospice Regulations",
      quality_measures: "Quality Measures",
      compliance_audit: "Compliance & Audit",
      pdgm: "PDGM",
      other: "Other"
    };
    return labels[category] || category;
  };

  const getCategoryColor = (category) => {
    const colors = {
      oasis: "bg-purple-100 text-purple-800",
      medicare_cop: "bg-red-100 text-red-800",
      billing_reimbursement: "bg-green-100 text-green-800",
      clinical_documentation: "bg-blue-100 text-blue-800",
      home_health_regulations: "bg-indigo-100 text-indigo-800",
      hospice_regulations: "bg-pink-100 text-pink-800",
      quality_measures: "bg-yellow-100 text-yellow-800",
      compliance_audit: "bg-orange-100 text-orange-800",
      pdgm: "bg-teal-100 text-teal-800",
      other: "bg-gray-100 text-gray-800"
    };
    return colors[category] || colors.other;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-8 h-8 text-blue-600" />
              Medicare Guidelines Library
            </h1>
            <p className="text-gray-600 mt-1">
              Official CMS guidelines and regulations for home health documentation
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button
                onClick={() => autoFetchMutation.mutate()}
                disabled={autoFetchMutation.isPending}
                variant="outline"
                className="border-green-500 text-green-700 hover:bg-green-50"
              >
                {autoFetchMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Auto-Fetching...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Auto-Fetch CMS Guidelines
                  </>
                )}
              </Button>
              <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Manual
                  </Button>
                </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Fetch Medicare Guideline from CMS.gov</DialogTitle>
                  <DialogDescription>
                    Enter the URL of a CMS.gov page to fetch and store the guideline content
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>CMS.gov URL *</Label>
                    <Input
                      placeholder="https://www.cms.gov/..."
                      value={newGuidelineUrl}
                      onChange={(e) => setNewGuidelineUrl(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Category *</Label>
                      <Select value={newGuidelineCategory} onValueChange={setNewGuidelineCategory}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="oasis">OASIS</SelectItem>
                          <SelectItem value="medicare_cop">Medicare CoP</SelectItem>
                          <SelectItem value="billing_reimbursement">Billing & Reimbursement</SelectItem>
                          <SelectItem value="clinical_documentation">Clinical Documentation</SelectItem>
                          <SelectItem value="home_health_regulations">Home Health Regulations</SelectItem>
                          <SelectItem value="hospice_regulations">Hospice Regulations</SelectItem>
                          <SelectItem value="quality_measures">Quality Measures</SelectItem>
                          <SelectItem value="compliance_audit">Compliance & Audit</SelectItem>
                          <SelectItem value="pdgm">PDGM</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Subcategory</Label>
                      <Input
                        placeholder="e.g., Skilled Nursing"
                        value={newGuidelineSubcategory}
                        onChange={(e) => setNewGuidelineSubcategory(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Keywords (comma-separated)</Label>
                    <Input
                      placeholder="e.g., homebound, skilled need, assessment"
                      value={newGuidelineKeywords}
                      onChange={(e) => setNewGuidelineKeywords(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>CMS Manual Chapter</Label>
                      <Input
                        placeholder="e.g., Chapter 7"
                        value={newGuidelineChapter}
                        onChange={(e) => setNewGuidelineChapter(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Regulatory Citation</Label>
                      <Input
                        placeholder="e.g., 42 CFR 484.55"
                        value={newGuidelineCitation}
                        onChange={(e) => setNewGuidelineCitation(e.target.value)}
                      />
                    </div>
                  </div>
                  {fetchGuidelineMutation.isError && (
                    <Alert variant="destructive">
                      <AlertCircle className="w-4 h-4" />
                      <AlertDescription>
                        {fetchGuidelineMutation.error?.message || 'Failed to fetch guideline'}
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddGuideline}
                      disabled={!newGuidelineUrl || fetchGuidelineMutation.isPending}
                    >
                      {fetchGuidelineMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Fetching...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Fetch & Add
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            </div>
          )}
          
          {autoFetchMutation.isSuccess && (
            <Alert className="mb-4 border-green-500 bg-green-50">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-800">
                {autoFetchMutation.data?.message || 'Guidelines fetched successfully!'}
              </AlertDescription>
            </Alert>
          )}
          
          {autoFetchMutation.isError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                {autoFetchMutation.error?.message || 'Failed to fetch guidelines automatically'}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Search and Filter */}
        <div className="space-y-3">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              <Input
                placeholder={useSemanticSearch ? "Ask in natural language (e.g., 'What are the requirements for homebound status?')" : "Search guidelines by title, keywords, or content..."}
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  if (!useSemanticSearch) {
                    setSemanticResults(null);
                    setSearchInterpretation('');
                  }
                }}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && useSemanticSearch) {
                    handleSearch();
                  }
                }}
                className="pl-10"
              />
            </div>
            {useSemanticSearch && (
              <Button 
                onClick={handleSearch}
                disabled={!searchTerm.trim() || semanticSearchMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {semanticSearchMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    AI Search
                  </>
                )}
              </Button>
            )}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="oasis">OASIS</SelectItem>
                <SelectItem value="medicare_cop">Medicare CoP</SelectItem>
                <SelectItem value="billing_reimbursement">Billing & Reimbursement</SelectItem>
                <SelectItem value="clinical_documentation">Clinical Documentation</SelectItem>
                <SelectItem value="home_health_regulations">Home Health Regulations</SelectItem>
                <SelectItem value="hospice_regulations">Hospice Regulations</SelectItem>
                <SelectItem value="quality_measures">Quality Measures</SelectItem>
                <SelectItem value="compliance_audit">Compliance & Audit</SelectItem>
                <SelectItem value="pdgm">PDGM</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Search Mode Toggle */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setUseSemanticSearch(!useSemanticSearch);
                setSemanticResults(null);
                setSearchInterpretation('');
              }}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-purple-600 transition-colors"
            >
              <div className={`w-10 h-6 rounded-full transition-colors ${useSemanticSearch ? 'bg-purple-600' : 'bg-gray-300'} relative`}>
                <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${useSemanticSearch ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <Sparkles className={`w-4 h-4 ${useSemanticSearch ? 'text-purple-600' : 'text-gray-400'}`} />
              <span className={useSemanticSearch ? 'text-purple-600 font-medium' : ''}>
                AI Semantic Search
              </span>
            </button>
            {searchInterpretation && (
              <Alert className="flex-1 py-2 border-purple-200 bg-purple-50">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <AlertDescription className="text-sm text-purple-900">
                  <strong>Search interpreted as:</strong> {searchInterpretation}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>

      {/* Guidelines List */}
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : filteredGuidelines.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500">
              {searchTerm || categoryFilter !== "all" 
                ? "No guidelines found matching your search"
                : "No guidelines available yet"}
            </p>
            {isAdmin && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setAddDialogOpen(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add First Guideline
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredGuidelines.map((guideline) => (
            <Card
              key={guideline.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => {
                setSelectedGuideline(guideline);
                setDialogOpen(true);
              }}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg mb-2">{guideline.title}</CardTitle>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Badge className={getCategoryColor(guideline.category)}>
                        {getCategoryLabel(guideline.category)}
                      </Badge>
                      {guideline.subcategory && (
                        <Badge variant="outline">{guideline.subcategory}</Badge>
                      )}
                      {guideline.regulatory_citation && (
                        <Badge variant="outline" className="text-xs">
                          {guideline.regulatory_citation}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-3">{guideline.summary}</p>
                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                  {guideline.effective_date && (
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Effective: {new Date(guideline.effective_date).toLocaleDateString()}
                    </div>
                  )}
                  {guideline.cms_manual_chapter && (
                    <div className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {guideline.cms_manual_chapter}
                    </div>
                  )}
                  {guideline.keywords && guideline.keywords.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <Tag className="w-3 h-3" />
                      {guideline.keywords.slice(0, 3).map((kw, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {kw}
                        </Badge>
                      ))}
                      {guideline.keywords.length > 3 && (
                        <span className="text-xs">+{guideline.keywords.length - 3} more</span>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Guideline Detail Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedGuideline && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <DialogTitle className="text-xl mb-2">{selectedGuideline.title}</DialogTitle>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <Badge className={getCategoryColor(selectedGuideline.category)}>
                        {getCategoryLabel(selectedGuideline.category)}
                      </Badge>
                      {selectedGuideline.subcategory && (
                        <Badge variant="outline">{selectedGuideline.subcategory}</Badge>
                      )}
                      {selectedGuideline.regulatory_citation && (
                        <Badge variant="outline">{selectedGuideline.regulatory_citation}</Badge>
                      )}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Are you sure you want to delete this guideline?')) {
                          deleteGuidelineMutation.mutate(selectedGuideline.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </DialogHeader>
              
              <div className="space-y-4">
                {/* Summary */}
                <Alert>
                  <CheckCircle2 className="w-4 h-4" />
                  <AlertDescription className="font-medium">
                    {selectedGuideline.summary}
                  </AlertDescription>
                </Alert>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedGuideline.effective_date && (
                    <div>
                      <span className="font-medium text-gray-700">Effective Date:</span>
                      <p className="text-gray-600">
                        {new Date(selectedGuideline.effective_date).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  {selectedGuideline.cms_manual_chapter && (
                    <div>
                      <span className="font-medium text-gray-700">CMS Manual:</span>
                      <p className="text-gray-600">{selectedGuideline.cms_manual_chapter}</p>
                    </div>
                  )}
                </div>

                {/* Keywords */}
                {selectedGuideline.keywords && selectedGuideline.keywords.length > 0 && (
                  <div>
                    <p className="font-medium text-gray-700 text-sm mb-2">Keywords:</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedGuideline.keywords.map((kw, idx) => (
                        <Badge key={idx} variant="secondary">{kw}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Related Diagnoses */}
                {selectedGuideline.related_diagnoses && selectedGuideline.related_diagnoses.length > 0 && (
                  <div>
                    <p className="font-medium text-gray-700 text-sm mb-2">Applies to Diagnoses:</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedGuideline.related_diagnoses.map((dx, idx) => (
                        <Badge key={idx} variant="outline">{dx}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full Content */}
                <div className="border-t pt-4">
                  <p className="font-medium text-gray-700 text-sm mb-3">Full Guideline Content:</p>
                  <div className="prose prose-sm max-w-none bg-gray-50 p-4 rounded-lg">
                    <ReactMarkdown>{selectedGuideline.content_markdown}</ReactMarkdown>
                  </div>
                </div>

                {/* Source Link */}
                <div className="border-t pt-4">
                  <a
                    href={selectedGuideline.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 text-sm flex items-center gap-1"
                  >
                    View Original on CMS.gov
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <p className="text-xs text-gray-500 mt-1">
                    Last fetched: {new Date(selectedGuideline.last_fetched_date).toLocaleString()}
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}