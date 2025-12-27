import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, UserPlus, Sparkles, BookOpen } from "lucide-react";

export default function EducationMaterialCard({ material, onView, onAssign }) {
  const getSourceIcon = () => {
    if (material.source === "ai_generated") return <Sparkles className="w-3 h-3" />;
    return <BookOpen className="w-3 h-3" />;
  };

  const getCategoryColor = (category) => {
    const colors = {
      "Diabetes Management": "bg-blue-100 text-blue-800",
      "Wound Care": "bg-red-100 text-red-800",
      "Heart Disease": "bg-pink-100 text-pink-800",
      "COPD/Respiratory": "bg-cyan-100 text-cyan-800",
      "Fall Prevention": "bg-orange-100 text-orange-800",
      "Medication Management": "bg-purple-100 text-purple-800",
      "Pain Management": "bg-yellow-100 text-yellow-800",
      "Nutrition": "bg-green-100 text-green-800",
      "Exercise/Mobility": "bg-teal-100 text-teal-800",
      "Mental Health": "bg-indigo-100 text-indigo-800",
      "Infection Control": "bg-red-100 text-red-800",
      "Post-Surgery Care": "bg-purple-100 text-purple-800",
      "Chronic Disease": "bg-gray-100 text-gray-800",
      "Safety": "bg-orange-100 text-orange-800",
      "General Health": "bg-blue-100 text-blue-800"
    };
    return colors[category] || "bg-gray-100 text-gray-800";
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start justify-between mb-2">
          <Badge className={getCategoryColor(material.category)}>
            {material.category}
          </Badge>
          <Badge variant="outline" className="flex items-center gap-1">
            {getSourceIcon()}
            {material.source === "ai_generated" ? "AI" : "Library"}
          </Badge>
        </div>
        <CardTitle className="text-lg line-clamp-2">{material.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-600 line-clamp-3 mb-4">
          {material.content?.substring(0, 150)}...
        </p>
        
        {material.tags && material.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {material.tags.slice(0, 3).map((tag, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {material.tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{material.tags.length - 3}
              </Badge>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onView} className="flex-1">
            <Eye className="w-4 h-4 mr-1" />
            View
          </Button>
          <Button size="sm" onClick={onAssign} className="flex-1 bg-blue-600 hover:bg-blue-700">
            <UserPlus className="w-4 h-4 mr-1" />
            Assign
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}