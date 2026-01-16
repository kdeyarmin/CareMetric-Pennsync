import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Search, FileText, Video, ExternalLink, CheckCircle2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

export default function EducationLibraryBrowser({ onSelectMaterial, selectedMaterials = [] }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const { data: materials = [], isLoading } = useQuery({
    queryKey: ['educationMaterials'],
    queryFn: async () => {
      return await base44.entities.PatientEducationMaterial.list('-created_date', 100);
    }
  });

  const filteredMaterials = materials.filter(material => {
    const matchesSearch = !searchQuery || 
      material.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      material.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      material.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesCategory = selectedCategory === 'all' || material.category === selectedCategory;
    
    return matchesSearch && matchesCategory && material.is_active !== false;
  });

  const categories = [...new Set(materials.map(m => m.category).filter(Boolean))];

  const getContentIcon = (type) => {
    switch (type) {
      case 'video': return Video;
      case 'pdf':
      case 'document': return FileText;
      default: return BookOpen;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Patient Education Library
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search education materials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={selectedCategory === 'all' ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setSelectedCategory('all')}
          >
            All
          </Badge>
          {categories.map(cat => (
            <Badge
              key={cat}
              variant={selectedCategory === cat ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </Badge>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-slate-500">Loading materials...</div>
        ) : filteredMaterials.length === 0 ? (
          <div className="text-center py-8 text-slate-500">No materials found</div>
        ) : (
          <div className="grid gap-3 max-h-96 overflow-y-auto">
            {filteredMaterials.map((material) => {
              const Icon = getContentIcon(material.content_type);
              const isSelected = selectedMaterials.some(m => m.id === material.id);
              
              return (
                <div
                  key={material.id}
                  className={`p-3 rounded-lg border transition-all ${
                    isSelected 
                      ? 'bg-green-50 dark:bg-green-900/30 border-green-400' 
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="w-4 h-4 text-indigo-600" />
                        <h4 className="font-semibold text-sm">{material.title}</h4>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                        {material.description}
                      </p>
                      <div className="flex gap-1 flex-wrap">
                        {material.category && (
                          <Badge variant="outline" className="text-xs">{material.category}</Badge>
                        )}
                        {material.tags?.slice(0, 3).map((tag, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => onSelectMaterial(material)}
                      variant={isSelected ? "outline" : "default"}
                      className={isSelected ? "bg-green-600 hover:bg-green-700 text-white" : ""}
                    >
                      {isSelected ? 'Selected' : 'Select'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}