import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
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
  Trash2
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";

export default function MedicareGuidelinesLibrary() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedGuideline, setSelectedGuideline] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

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

  const filteredGuidelines = guidelines.filter(guideline => {
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
      oasis: "bg-navy-100 text-navy-800",
      medicare_cop: "bg-red-100 text-red-800",
      billing_reimbursement: "bg-emerald-100 text-emerald-800",
      clinical_documentation: "bg-blue-100 text-blue-800",
      home_health_regulations: "bg-indigo-100 text-indigo-800",
      hospice_regulations: "bg-gold-100 text-gold-800",
      quality_measures: "bg-amber-100 text-amber-800",
      compliance_audit: "bg-orange-100 text-orange-800",
      pdgm: "bg-teal-100 text-teal-800",
      other: "bg-slate-100 text-slate-800"
    };
    return colors[category] || colors.other;
  };

  return (
    <PageContainer>
      <PageHeader
        icon={BookOpen}
        eyebrow="Resources"
        title="Medicare Guidelines Library"
        description="Official CMS guidelines and regulations for home health documentation"
        favoritePage="MedicareGuidelinesLibrary"
        actions={isAdmin && (
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto min-h-[44px]">
                <Plus className="w-4 h-4 mr-2" />
                <span className="hidden sm:inline">Add Guideline</span>
                <span className="sm:hidden">Add</span>
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
        )}
      />

      {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
            <Input
              placeholder="Search guidelines by title, keywords, or content..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-11 touch-target"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-64 h-11 touch-target">
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

      {/* Guidelines List */}
      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : filteredGuidelines.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={searchTerm || categoryFilter !== "all" ? "No guidelines found" : "No guidelines yet"}
          description={searchTerm || categoryFilter !== "all"
            ? "No guidelines match your search."
            : "Medicare guidelines will appear here once added."}
          action={isAdmin && (
            <Button variant="outline" onClick={() => setAddDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add First Guideline
            </Button>
          )}
        />
      ) : (
        <div className="grid gap-3 sm:gap-4">
          {filteredGuidelines.map((guideline) => (
            <Card
              key={guideline.id}
              className="hover:shadow-md transition-shadow cursor-pointer touch-target"
              onClick={() => {
                setSelectedGuideline(guideline);
                setDialogOpen(true);
              }}
            >
              <CardHeader className="p-3 sm:p-4 md:p-6 pb-2 sm:pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base sm:text-lg mb-2 break-words">{guideline.title}</CardTitle>
                    <div className="flex flex-wrap gap-1 sm:gap-2 mb-2">
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
              <CardContent className="p-3 sm:p-4 md:p-6">
                <p className="text-xs sm:text-sm text-slate-600 mb-3">{guideline.summary}</p>
                <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-slate-500">
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
                      aria-label="Delete guideline"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (await confirm({ title: "Delete guideline?", description: "Are you sure you want to delete this guideline? This can't be undone.", confirmText: "Delete", destructive: true })) {
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
                      <span className="font-medium text-slate-700">Effective Date:</span>
                      <p className="text-slate-600">
                        {new Date(selectedGuideline.effective_date).toLocaleDateString()}
                      </p>
                    </div>
                  )}
                  {selectedGuideline.cms_manual_chapter && (
                    <div>
                      <span className="font-medium text-slate-700">CMS Manual:</span>
                      <p className="text-slate-600">{selectedGuideline.cms_manual_chapter}</p>
                    </div>
                  )}
                </div>

                {/* Keywords */}
                {selectedGuideline.keywords && selectedGuideline.keywords.length > 0 && (
                  <div>
                    <p className="font-medium text-slate-700 text-sm mb-2">Keywords:</p>
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
                    <p className="font-medium text-slate-700 text-sm mb-2">Applies to Diagnoses:</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedGuideline.related_diagnoses.map((dx, idx) => (
                        <Badge key={idx} variant="outline">{dx}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Full Content */}
                <div className="border-t pt-4">
                  <p className="font-medium text-slate-700 text-sm mb-3">Full Guideline Content:</p>
                  <div className="prose prose-sm max-w-none bg-slate-50 p-4 rounded-lg">
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
                  <p className="text-xs text-slate-500 mt-1">
                    Last fetched: {new Date(selectedGuideline.last_fetched_date).toLocaleString()}
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}