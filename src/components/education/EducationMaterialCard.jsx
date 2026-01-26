import React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Video, FileJson, Eye, Star, Download } from "lucide-react";

const iconMap = {
  article: <FileText className="w-5 h-5" />,
  video: <Video className="w-5 h-5" />,
  pdf: <FileJson className="w-5 h-5" />,
  infographic: <FileText className="w-5 h-5" />,
  link: <FileText className="w-5 h-5" />
};

const typeColors = {
  article: "bg-blue-100 text-blue-800",
  video: "bg-red-100 text-red-800",
  pdf: "bg-amber-100 text-amber-800",
  infographic: "bg-purple-100 text-purple-800",
  link: "bg-green-100 text-green-800"
};

export default function EducationMaterialCard({ material, onOpen }) {
  return (
    <Card className="hover:shadow-lg transition-all duration-200 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1">
            <div className="text-slate-600 mt-1">{iconMap[material.material_type]}</div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900">{material.title}</h3>
              <p className="text-xs text-slate-500 mt-1">{material.description}</p>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Diagnoses */}
        <div className="flex flex-wrap gap-1">
          {material.diagnoses && material.diagnoses.map((diagnosis) => (
            <Badge key={diagnosis} variant="outline" className="text-xs">
              {diagnosis}
            </Badge>
          ))}
        </div>

        {/* Meta info */}
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-600">
          <Badge className={typeColors[material.material_type]}>
            {material.material_type.charAt(0).toUpperCase() + material.material_type.slice(1)}
          </Badge>

          {material.difficulty_level && (
            <Badge variant="outline" className="text-xs">
              {material.difficulty_level}
            </Badge>
          )}

          {material.duration_minutes && (
            <span>⏱️ {material.duration_minutes} min</span>
          )}

          <div className="flex items-center gap-1">
            <Eye className="w-3 h-3" />
            <span>{material.view_count || 0} views</span>
          </div>

          {material.average_rating && (
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
              <span>{material.average_rating.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Action button */}
        <Button
          onClick={() => onOpen(material)}
          className="w-full bg-blue-600 hover:bg-blue-700"
          size="sm"
        >
          <Download className="w-3 h-3 mr-1" />
          Access Material
        </Button>
      </CardContent>
    </Card>
  );
}