import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Copy, Trash2, History, Search, Filter, Grid3x3, List } from "lucide-react";
import { toast } from "sonner";
import PDFTemplateBuilder from "@/components/documents/PDFTemplateBuilder";

const CATEGORIES = ["consent", "assessment", "care_plan", "discharge", "admission", "other"];

export default function EnhancedPDFTemplateManager() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [viewMode, setViewMode] = useState("grid"); // grid or list
  const [showVersions, setShowVersions] = useState(null);
  const [showBuilder, setShowBuilder] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["pdf-templates"],
    queryFn: () => base44.entities.PDFTemplate.list("-created_date"),
    initialData: []
  });

  const deleteMutation = useMutation({
    mutationFn: (templateId) => base44.entities.PDFTemplate.delete(templateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pdf-templates"] });
      toast.success("Template deleted");
    },
    onError: () => toast.error("Failed to delete template")
  });

  const copyMutation = useMutation({
    mutationFn: (template) => base44.entities.PDFTemplate.create({
      template_name: `${template.template_name} (Copy)`,
      template_category: template.template_category,
      description: template.description || "",
      template_file_url: template.template_file_url || "",
      field_mappings: template.field_mappings || [],
      signature_fields: template.signature_fields || [],
      visual_elements: template.visual_elements || [],
      is_active: template.is_active ?? true,
      version: "1.0",
      usage_count: 0,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pdf-templates"] });
      toast.success("Template duplicated");
    },
    onError: () => toast.error("Failed to duplicate template")
  });

  // Filter and search logic
  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const matchesSearch =
        template.template_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === "all" || template.template_category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [templates, searchQuery, selectedCategory]);

  // Group templates by category
  const templatesByCategory = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      category: cat,
      templates: filteredTemplates.filter((t) => t.template_category === cat)
    })).filter((g) => g.templates.length > 0);
  }, [filteredTemplates]);

  const getCategoryIcon = (category) => {
    const icons = {
      consent: "📋",
      assessment: "📊",
      care_plan: "🎯",
      discharge: "📤",
      admission: "📥",
      other: "📄"
    };
    return icons[category] || "📄";
  };

  const getCategoryLabel = (category) => {
    return category.replace(/_/g, " ").charAt(0).toUpperCase() + category.slice(1).replace(/_/g, " ");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Template Library</h2>
          <p className="text-sm text-slate-600 mt-1">
            {filteredTemplates.length} of {templates.length} templates
          </p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => setShowBuilder(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search templates by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 text-sm"
          />
        </div>

        {/* Category Filter & View Toggle */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1">
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="text-sm">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Filter by category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {getCategoryIcon(cat)} {getCategoryLabel(cat)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* View Toggle */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("grid")}
            >
              <Grid3x3 className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setViewMode("list")}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Templates Grid/List View */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading templates...</div>
      ) : filteredTemplates.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600">No templates found</p>
          <p className="text-sm text-slate-500 mt-1">Try adjusting your search or filters</p>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="space-y-8">
          {templatesByCategory.map((group) => (
            <div key={group.category}>
              <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <span className="text-2xl">{getCategoryIcon(group.category)}</span>
                {getCategoryLabel(group.category)}
                <Badge variant="outline">{group.templates.length}</Badge>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.templates.map((template) => (
                  <TemplateGridCard
                    key={template.id}
                    template={template}
                    onCopy={() => copyMutation.mutate(template)}
                    onDelete={() => deleteMutation.mutate(template.id)}
                    onViewVersions={() => setShowVersions(template.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {templatesByCategory.map((group) => (
            <div key={group.category}>
              <h3 className="text-sm font-semibold text-slate-600 uppercase mt-4 mb-2 px-2">
                {getCategoryIcon(group.category)} {getCategoryLabel(group.category)}
              </h3>
              {group.templates.map((template) => (
                <TemplateListRow
                  key={template.id}
                  template={template}
                  onDelete={() => deleteMutation.mutate(template.id)}
                  onViewVersions={() => setShowVersions(template.id)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Version History Modal */}
      {showVersions && (
        <VersionHistoryModal
          parentId={showVersions}
          onClose={() => setShowVersions(null)}
        />
      )}

      {/* New-template builder (the same dialog used by the Document Hub) */}
      <PDFTemplateBuilder open={showBuilder} onClose={() => setShowBuilder(false)} />
    </div>
  );
}

function TemplateGridCard({ template, onCopy, onDelete, onViewVersions }) {
  return (
    <Card className="p-4 flex flex-col hover:shadow-md transition-shadow h-full">
      <div className="flex-1">
        <h4 className="font-semibold text-slate-900 text-sm line-clamp-2">
          {template.template_name}
        </h4>
        <p className="text-xs text-slate-600 mt-2 line-clamp-2">
          {template.description}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-xs">
            v{template.version}
          </Badge>
          {template.usage_count > 0 && (
            <span className="text-xs text-slate-500">
              Used {template.usage_count} time{template.usage_count !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {!template.is_active && (
          <Badge className="bg-slate-100 text-slate-700 text-xs w-full text-center">
            Inactive
          </Badge>
        )}

        <div className="flex gap-1 pt-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-1" onClick={onCopy} aria-label="Duplicate template">
            <Copy className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-1"
            onClick={onViewVersions}
          >
            <History className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-1"
            onClick={onDelete}
          >
            <Trash2 className="w-3 h-3 text-red-600" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function TemplateListRow({ template, onDelete, onViewVersions }) {
  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-sm text-slate-900 truncate">
            {template.template_name}
          </h4>
          <Badge variant="outline" className="text-xs shrink-0">
            v{template.version}
          </Badge>
          {!template.is_active && (
            <Badge className="bg-slate-200 text-slate-700 text-xs shrink-0">
              Inactive
            </Badge>
          )}
        </div>
        <p className="text-xs text-slate-600 mt-0.5 truncate">
          {template.description}
        </p>
      </div>

      <div className="flex gap-1 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onViewVersions}>
          <History className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onDelete}
        >
          <Trash2 className="w-3 h-3 text-red-600" />
        </Button>
      </div>
    </div>
  );
}

function VersionHistoryModal({ parentId, onClose }) {
  const { data: versions = [] } = useQuery({
    queryKey: ["template-versions", parentId],
    queryFn: () =>
      base44.entities.PDFTemplate.filter({
        parent_template_id: parentId
      }, "-created_date"),
    initialData: []
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">Version History</h3>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          {versions.length === 0 ? (
            <p className="text-sm text-slate-600">No versions found</p>
          ) : (
            versions.map((version) => (
              <div key={version.id} className="p-3 border rounded-lg">
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-medium text-sm">
                      Version {version.version}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {new Date(version.created_date).toLocaleDateString()}
                    </p>
                  </div>
                  {version.usage_count > 0 && (
                    <Badge variant="outline" className="text-xs">
                      Used {version.usage_count}x
                    </Badge>
                  )}
                </div>
                {version.change_notes && (
                  <p className="text-xs text-slate-700 mt-2 bg-slate-50 p-2 rounded">
                    {version.change_notes}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}