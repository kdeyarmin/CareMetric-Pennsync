import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Zap, Users, FileText, Brain, Mic, Target, Calendar, Shield, BarChart3, GraduationCap, ListTodo, Lock, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";

const FEATURES = [
{
  icon: Brain,
  title: "Smart Notes Assistant",
  description: "AI-powered documentation assistant that enhances clinical notes in real-time, ensuring compliance and reducing documentation time.",
  category: "Documentation"
},
{
  icon: Mic,
  title: "Medical Scribe",
  description: "Voice-to-text medical scribe that transcribes patient interactions and generates structured clinical documentation.",
  category: "Documentation"
},
{
  icon: Users,
  title: "Patient Management",
  description: "Centralized patient database with comprehensive health records, demographics, and care history.",
  category: "Patients"
},
{
  icon: Target,
  title: "Care Plan Management",
  description: "Automated care plan creation, tracking, and adjustments based on patient progress and clinical indicators.",
  category: "Care"
},
{
  icon: FileText,
  title: "Document Generation",
  description: "Generate customizable patient education materials, discharge summaries, and referral letters with AI assistance.",
  category: "Documents"
},
{
  icon: Calendar,
  title: "Provider Scheduling",
  description: "Intelligent scheduling system that optimizes visit timing and route planning for maximum efficiency.",
  category: "Operations"
},
{
  icon: Shield,
  title: "OASIS & Compliance",
  description: "Automated OASIS validation and compliance checking to ensure Medicare requirements are met.",
  category: "Compliance"
},
{
  icon: BarChart3,
  title: "Analytics Dashboard",
  description: "Real-time performance metrics, compliance reports, and clinical outcome analytics.",
  category: "Analytics"
},
{
  icon: GraduationCap,
  title: "Training & Development",
  description: "Personalized training modules with AI-generated recommendations based on compliance gaps and skill assessments.",
  category: "Training"
},
{
  icon: ListTodo,
  title: "Task Management",
  description: "Intelligent task creation and assignment with automatic reminders and priority management.",
  category: "Operations"
},
{
  icon: Lock,
  title: "HIPAA Compliance & Security",
  description: "Enterprise-grade encryption, audit trails, and access controls meeting all healthcare security standards.",
  category: "Security"
},
{
  icon: AlertCircle,
  title: "Patient Risk Alerts",
  description: "AI-powered early warning system that identifies patients at risk for readmission or adverse events.",
  category: "Clinical"
}];


const CATEGORIES = ["All", ...new Set(FEATURES.map((f) => f.category))];

export default function Features() {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [isGeneratingGuide, setIsGeneratingGuide] = useState(false);

  const filteredFeatures = selectedCategory === "All" ?
  FEATURES :
  FEATURES.filter((f) => f.category === selectedCategory);

  const handleDownloadGuide = async () => {
    setIsGeneratingGuide(true);
    try {
      const response = await base44.functions.invoke('generateUserGuidePDF', {});
      if (response?.data?.file_url) {
        const link = document.createElement('a');
        link.href = response.data.file_url;
        link.download = 'CareMetric-AI-User-Guide.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('Error generating guide:', error);
      alert('Failed to generate user guide');
    } finally {
      setIsGeneratingGuide(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-4">CareMetric AI Features</h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-6">Comprehensive tools designed to streamline documentation, enhance compliance, and improve patient outcomes.

        </p>
        
        <Button
          onClick={handleDownloadGuide}
          disabled={isGeneratingGuide} className="bg-slate-300 text-slate-900 px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow-sm dark:bg-slate-600 dark:hover:bg-slate-700 h-9 hover:bg-blue-700">

          <Download className="w-4 h-4 mr-2" />
          {isGeneratingGuide ? 'Generating Guide...' : 'Download User Guide PDF'}
        </Button>
      </div>

      {/* Category Filter */}
      <div className="mb-8 flex flex-wrap gap-2">
        {CATEGORIES.map((category) =>
        <Badge
          key={category}
          variant={selectedCategory === category ? "default" : "outline"}
          className="cursor-pointer px-3 py-1.5"
          onClick={() => setSelectedCategory(category)}>
            {category}
          </Badge>
        )}
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredFeatures.map((feature, idx) => {
          const Icon = feature.icon;
          return (
            <Card key={idx} className="hover:shadow-lg transition-shadow hover-lift">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <Icon className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  <Badge variant="secondary" className="text-xs">{feature.category}</Badge>
                </div>
                <CardTitle className="mt-3">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {feature.description}
                </p>
              </CardContent>
            </Card>);

        })}
      </div>
    </div>);

}