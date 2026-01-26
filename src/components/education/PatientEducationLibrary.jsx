import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Search, Filter, ExternalLink } from "lucide-react";
import EducationMaterialCard from "./EducationMaterialCard";
import EmptyState from "@/components/ui/EmptyState";

export default function PatientEducationLibrary({ patientDiagnosis = null }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMaterialType, setSelectedMaterialType] = useState("all");
  const [selectedDifficulty, setSelectedDifficulty] = useState("all");

  const { data: materials = [], isLoading } = useQuery({
    queryKey: ['educationMaterials'],
    queryFn: () => base44.entities.PatientEducationMaterial.filter({
      is_approved: true,
      is_active: true
    }, '-view_count', 200)
  });

  const filteredMaterials = materials.filter(m => {
    const matchesSearch = !searchTerm || 
      m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.diagnoses && m.diagnoses.some(d => d.toLowerCase().includes(searchTerm.toLowerCase())));

    const matchesType = selectedMaterialType === "all" || m.material_type === selectedMaterialType;

    const matchesDifficulty = selectedDifficulty === "all" || m.difficulty_level === selectedDifficulty;

    const matchesDiagnosis = !patientDiagnosis || (m.diagnoses && m.diagnoses.some(d =>
      d.toLowerCase().includes(patientDiagnosis.toLowerCase())
    ));

    return matchesSearch && matchesType && matchesDifficulty && matchesDiagnosis;
  });

  const handleOpenMaterial = (material) => {
    if (material.content_url) {
      window.open(material.content_url, '_blank');
    } else if (material.file_url) {
      const link = document.createElement('a');
      link.href = material.file_url;
      link.download = material.title;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
          📚 Education Library
        </h2>
        <p className="text-slate-600 mt-2">
          {patientDiagnosis 
            ? `Materials for ${patientDiagnosis}`
            : "Explore educational resources about health conditions and treatments"
          }
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search materials..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Type filter */}
            <Select value={selectedMaterialType} onValueChange={setSelectedMaterialType}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="article">Articles</SelectItem>
                <SelectItem value="video">Videos</SelectItem>
                <SelectItem value="pdf">PDFs</SelectItem>
                <SelectItem value="infographic">Infographics</SelectItem>
              </SelectContent>
            </Select>

            {/* Difficulty filter */}
            <Select value={selectedDifficulty} onValueChange={setSelectedDifficulty}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Active filters */}
          {(searchTerm || selectedMaterialType !== "all" || selectedDifficulty !== "all") && (
            <div className="flex flex-wrap gap-2">
              {searchTerm && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  Search: {searchTerm}
                </Badge>
              )}
              {selectedMaterialType !== "all" && (
                <Badge variant="secondary">
                  Type: {selectedMaterialType}
                </Badge>
              )}
              {selectedDifficulty !== "all" && (
                <Badge variant="secondary">
                  Level: {selectedDifficulty}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchTerm("");
                  setSelectedMaterialType("all");
                  setSelectedDifficulty("all");
                }}
                className="text-xs"
              >
                Clear filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Materials grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <p className="text-slate-600">Loading materials...</p>
        </div>
      ) : filteredMaterials.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No Materials Found"
          description="Try adjusting your filters or search terms"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredMaterials.map((material) => (
            <EducationMaterialCard
              key={material.id}
              material={material}
              onOpen={handleOpenMaterial}
            />
          ))}
        </div>
      )}

      {/* Stats */}
      {filteredMaterials.length > 0 && (
        <Card className="bg-slate-50">
          <CardContent className="p-4 text-sm text-slate-600">
            Showing {filteredMaterials.length} of {materials.length} materials
          </CardContent>
        </Card>
      )}
    </div>
  );
}