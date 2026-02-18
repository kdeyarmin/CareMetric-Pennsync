import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Plus, TrendingUp, CheckCircle } from 'lucide-react';
import PersonalizedEducationGenerator from './PersonalizedEducationGenerator';
import EducationMaterialCard from './EducationMaterialCard';

export default function PatientEducationHub({ patientId }) {
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const { data: materials = [], isLoading: materialsLoading } = useQuery({
    queryKey: ['educationMaterials', patientId],
    queryFn: async () => {
      const all = await base44.entities.PatientEducationMaterial.list();
      return all.filter(m => m.target_patient_id === patientId || !m.patient_specific);
    }
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery({
    queryKey: ['educationAssignments', patientId],
    queryFn: () => base44.entities.PatientEducationAssignment.filter({ patient_id: patientId })
  });

  const { data: engagement = [] } = useQuery({
    queryKey: ['educationEngagement', patientId],
    queryFn: () => base44.entities.PatientEducationEngagement.filter({ patient_id: patientId })
  });

  const assignedMaterialIds = new Set(assignments.map(a => a.material_id));
  const completedMaterialIds = new Set(
    engagement.filter(e => e.action_type === 'completed').map(e => e.material_id)
  );

  const personalizedMaterials = materials.filter(m => m.target_patient_id === patientId);
  const generalMaterials = materials.filter(m => !m.target_patient_id);

  const assignedMaterials = materials.filter(m => assignedMaterialIds.has(m.id));
  const completedCount = assignedMaterials.filter(m => completedMaterialIds.has(m.id)).length;
  const engagementRate = assignedMaterials.length > 0 
    ? Math.round((completedCount / assignedMaterials.length) * 100) 
    : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5" />
                Patient Education Hub
              </CardTitle>
              <CardDescription>
                Personalized health education materials and resources
              </CardDescription>
            </div>
            <Button onClick={() => setGeneratorOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Generate New Material
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="p-4 bg-blue-50 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Assigned Materials</div>
              <div className="text-2xl font-bold">{assignedMaterials.length}</div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Completed</div>
              <div className="text-2xl font-bold flex items-center gap-2">
                {completedCount}
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <div className="text-sm text-gray-600 mb-1">Engagement Rate</div>
              <div className="text-2xl font-bold flex items-center gap-2">
                {engagementRate}%
                <TrendingUp className="h-5 w-5 text-purple-600" />
              </div>
            </div>
          </div>

          <Tabs defaultValue="assigned">
            <TabsList>
              <TabsTrigger value="assigned">
                Assigned ({assignedMaterials.length})
              </TabsTrigger>
              <TabsTrigger value="personalized">
                Personalized ({personalizedMaterials.length})
              </TabsTrigger>
              <TabsTrigger value="library">
                Library ({generalMaterials.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="assigned" className="space-y-3 mt-4">
              {assignedMaterials.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No materials assigned yet
                </div>
              ) : (
                assignedMaterials.map(material => (
                  <div key={material.id} className="relative">
                    {completedMaterialIds.has(material.id) && (
                      <Badge className="absolute top-2 right-2 bg-green-100 text-green-800">
                        Completed
                      </Badge>
                    )}
                    <EducationMaterialCard material={material} patientId={patientId} />
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="personalized" className="space-y-3 mt-4">
              {personalizedMaterials.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No personalized materials yet. Generate one above!
                </div>
              ) : (
                personalizedMaterials.map(material => (
                  <EducationMaterialCard 
                    key={material.id} 
                    material={material} 
                    patientId={patientId}
                    showAssignButton={!assignedMaterialIds.has(material.id)}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="library" className="space-y-3 mt-4">
              {generalMaterials.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No general library materials available
                </div>
              ) : (
                generalMaterials.map(material => (
                  <EducationMaterialCard 
                    key={material.id} 
                    material={material} 
                    patientId={patientId}
                    showAssignButton={!assignedMaterialIds.has(material.id)}
                  />
                ))
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <PersonalizedEducationGenerator
        patientId={patientId}
        open={generatorOpen}
        onOpenChange={setGeneratorOpen}
      />
    </div>
  );
}