import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BookOpen, 
  Search, 
  Plus, 
  Sparkles,
  Filter,
  Eye,
  UserPlus,
  Download
} from "lucide-react";
import EducationMaterialCard from "../components/education/EducationMaterialCard";
import AIEducationGenerator from "../components/education/AIEducationGenerator";
import AssignMaterialDialog from "../components/education/AssignMaterialDialog";
import MaterialViewer from "../components/education/MaterialViewer";

export default function PatientEducationLibrary() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [viewingMaterial, setViewingMaterial] = useState(null);
  const [assigningMaterial, setAssigningMaterial] = useState(null);

  const { data: materials = [], isLoading } = useQuery({
    queryKey: ['educationMaterials'],
    queryFn: () => base44.entities.PatientEducationMaterial.filter({ is_active: true }, '-created_date'),
    initialData: [],
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: [],
  });

  const categories = [
    "Diabetes Management",
    "Wound Care",
    "Heart Disease",
    "COPD/Respiratory",
    "Fall Prevention",
    "Medication Management",
    "Pain Management",
    "Nutrition",
    "Exercise/Mobility",
    "Mental Health",
    "Infection Control",
    "Post-Surgery Care",
    "Chronic Disease",
    "Safety",
    "General Health"
  ];

  const filteredMaterials = materials.filter(material => {
    const matchesSearch = searchTerm === "" || 
      material.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      material.content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      material.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesCategory = selectedCategory === "all" || material.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const groupedMaterials = categories.reduce((acc, category) => {
    acc[category] = filteredMaterials.filter(m => m.category === category);
    return acc;
  }, {});

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <BookOpen className="w-8 h-8 text-blue-600" />
              Patient Education Library
            </h1>
            <p className="text-gray-600 mt-2">
              Search, view, and assign educational materials to your patients
            </p>
          </div>
          <Button
            onClick={() => setShowAIGenerator(true)}
            className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Generate with AI
          </Button>
        </div>

        <div className="flex gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <Input
              placeholder="Search by title, keywords, or content..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-gray-500" />
          <Badge
            variant={selectedCategory === "all" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setSelectedCategory("all")}
          >
            All ({materials.length})
          </Badge>
          {categories.map(category => (
            <Badge
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setSelectedCategory(category)}
            >
              {category} ({groupedMaterials[category]?.length || 0})
            </Badge>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-500">Loading materials...</p>
        </div>
      ) : filteredMaterials.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <BookOpen className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No materials found</h3>
            <p className="text-gray-600 mb-4">
              {searchTerm || selectedCategory !== "all" 
                ? "Try adjusting your search or filters" 
                : "Start by generating educational materials with AI"}
            </p>
            <Button onClick={() => setShowAIGenerator(true)}>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate First Material
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMaterials.map(material => (
            <EducationMaterialCard
              key={material.id}
              material={material}
              onView={() => setViewingMaterial(material)}
              onAssign={() => setAssigningMaterial(material)}
            />
          ))}
        </div>
      )}

      {showAIGenerator && (
        <AIEducationGenerator
          onClose={() => setShowAIGenerator(false)}
          onGenerated={() => {
            queryClient.invalidateQueries({ queryKey: ['educationMaterials'] });
            setShowAIGenerator(false);
          }}
        />
      )}

      {viewingMaterial && (
        <MaterialViewer
          material={viewingMaterial}
          onClose={() => setViewingMaterial(null)}
          onAssign={() => {
            setAssigningMaterial(viewingMaterial);
            setViewingMaterial(null);
          }}
        />
      )}

      {assigningMaterial && (
        <AssignMaterialDialog
          material={assigningMaterial}
          patients={patients}
          onClose={() => setAssigningMaterial(null)}
          onAssigned={() => {
            setAssigningMaterial(null);
          }}
        />
      )}
    </div>
  );
}