import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Lightbulb, Users } from "lucide-react";
import PatientEducationGenerator from "../components/education/PatientEducationGenerator";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function PatientEducationHub() {
  const [generatedMaterials, setGeneratedMaterials] = useState([]);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const handleMaterialGenerated = (material) => {
    setGeneratedMaterials(prev => [
      {
        id: Date.now(),
        title: material.title,
        content: material.content,
        generated_at: new Date(),
        ...material
      },
      ...prev
    ]);
  };

  return (
    <div className="min-h-screen p-4 md:p-6 pb-20">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center justify-center gap-2">
            <BookOpen className="w-8 h-8 text-blue-600" />
            Patient Education Hub
          </h1>
          <p className="text-gray-600">
            Generate personalized, AI-powered educational materials for your patients
          </p>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="generator" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="generator">Create Material</TabsTrigger>
            <TabsTrigger value="history">Recent Materials ({generatedMaterials.length})</TabsTrigger>
          </TabsList>

          {/* Generator Tab */}
          <TabsContent value="generator" className="space-y-4">
            <PatientEducationGenerator
              patientAge={currentUser?.age}
              onMaterialGenerated={handleMaterialGenerated}
            />

            {/* Tips Card */}
            <Card className="border-green-200 bg-green-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-green-600" />
                  Tips for Effective Patient Education
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <ul className="text-xs space-y-2 text-gray-700">
                  <li className="flex gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Tailor to age:</strong> Select appropriate reading level for your patient's comprehension</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Review content:</strong> Customize generated materials to match your patient's specific needs</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Use visuals:</strong> Pair with diagrams or videos for better understanding</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Encourage questions:</strong> Make it clear patients should ask about anything unclear</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-green-600 font-bold">•</span>
                    <span><strong>Follow up:</strong> Check understanding during next visit and adjust if needed</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            {generatedMaterials.length > 0 ? (
              <div className="grid gap-4">
                {generatedMaterials.map((material) => (
                  <Card key={material.id} className="hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base">{material.title}</CardTitle>
                          <p className="text-xs text-gray-500 mt-1">
                            Generated {new Date(material.generated_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="text-xs text-gray-700 line-clamp-3">
                        {material.content}
                      </div>
                      {material.key_points?.length > 0 && (
                        <div className="text-xs">
                          <strong>Key Points:</strong> {material.key_points.slice(0, 2).join(' • ')}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-600">No materials generated yet. Create one to get started!</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}