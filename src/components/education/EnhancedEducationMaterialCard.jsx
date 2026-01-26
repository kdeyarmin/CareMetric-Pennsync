import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, Clock, Users, Star } from 'lucide-react';
import MaterialRatingWidget from './MaterialRatingWidget';
import MarkMaterialAsReadButton from './MarkMaterialAsReadButton';

export default function EnhancedEducationMaterialCard({
  material,
  assignmentId,
  isAssigned,
  onActionComplete,
}) {
  const difficultyColors = {
    beginner: 'bg-green-100 text-green-800',
    intermediate: 'bg-yellow-100 text-yellow-800',
    advanced: 'bg-red-100 text-red-800',
  };

  return (
    <Card className="h-full flex flex-col hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base line-clamp-2">{material.title}</CardTitle>
            <p className="text-xs text-slate-500 mt-1">{material.description}</p>
          </div>
          {material.average_rating && (
            <div className="flex items-center gap-1 whitespace-nowrap">
              <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
              <span className="text-sm font-semibold">{material.average_rating}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <Badge className={difficultyColors[material.difficulty_level] || 'bg-slate-100 text-slate-800'}>
            {material.difficulty_level}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {material.material_type}
          </Badge>
          {material.duration_minutes && (
            <Badge variant="outline" className="text-xs flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {material.duration_minutes}m
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col space-y-3">
        {material.diagnoses && material.diagnoses.length > 0 && (
          <div>
            <p className="text-xs text-slate-600 mb-1">Related Diagnoses:</p>
            <div className="flex flex-wrap gap-1">
              {material.diagnoses.slice(0, 3).map((diagnosis) => (
                <Badge key={diagnosis} variant="secondary" className="text-xs">
                  {diagnosis}
                </Badge>
              ))}
              {material.diagnoses.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{material.diagnoses.length - 3}
                </Badge>
              )}
            </div>
          </div>
        )}

        {material.view_count !== undefined && (
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Users className="w-3 h-3" />
            <span>{material.view_count} views</span>
          </div>
        )}

        <div className="flex-1" />

        {isAssigned && (
          <MarkMaterialAsReadButton
            materialId={material.id}
            assignmentId={assignmentId}
            onMarkRead={onActionComplete}
          />
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-9 text-sm"
            onClick={() => window.open(material.content_url, '_blank')}
          >
            <ExternalLink className="w-4 h-4 mr-1" />
            View
          </Button>
          {material.file_url && (
            <Button
              variant="outline"
              className="flex-1 h-9 text-sm"
              onClick={() => window.open(material.file_url, '_blank')}
            >
              Download
            </Button>
          )}
        </div>

        <MaterialRatingWidget
          materialId={material.id}
          materialTitle={material.title}
          onRatingSubmitted={onActionComplete}
        />
      </CardContent>
    </Card>
  );
}