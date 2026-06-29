import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  BookOpen,
  Heart,
  Pill,
  Activity,
  Utensils,
  Shield,
  Brain,
  AlertTriangle,
  ChevronRight
} from "lucide-react";

export default function EducationLibrary({ patient, onSelectMaterial }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const categories = [
    { id: "all", label: "All Topics", icon: BookOpen },
    { id: "cardiac", label: "Heart & Cardiac", icon: Heart },
    { id: "respiratory", label: "Respiratory", icon: Activity },
    { id: "diabetes", label: "Diabetes", icon: Pill },
    { id: "nutrition", label: "Nutrition", icon: Utensils },
    { id: "safety", label: "Safety", icon: Shield },
    { id: "wound", label: "Wound Care", icon: AlertTriangle },
    { id: "hospice", label: "Hospice/Comfort", icon: Brain },
    { id: "stroke", label: "Stroke & Neuro", icon: Brain },
    { id: "mental", label: "Mental Health", icon: Brain },
    { id: "orthopedic", label: "Orthopedic", icon: Activity },
    { id: "renal", label: "Kidney Health", icon: Shield },
    { id: "medication", label: "Medications", icon: Pill },
  ];

  const educationTopics = [
    {
      id: 1,
      title: "Understanding Congestive Heart Failure (CHF)",
      category: "cardiac",
      description: "Learn about CHF, daily weight monitoring, and when to call your nurse.",
      topics: ["Daily weight monitoring", "Fluid restriction", "Medication adherence", "Warning signs"],
      readingLevel: "simple"
    },
    {
      id: 2,
      title: "Managing Your Blood Pressure",
      category: "cardiac",
      description: "Tips for controlling high blood pressure at home.",
      topics: ["Blood pressure monitoring", "Low-sodium diet", "Stress management", "Medications"],
      readingLevel: "simple"
    },
    {
      id: 3,
      title: "Living with COPD",
      category: "respiratory",
      description: "Breathing exercises and techniques for managing COPD.",
      topics: ["Pursed lip breathing", "Oxygen therapy", "Inhaler use", "Avoiding triggers"],
      readingLevel: "simple"
    },
    {
      id: 4,
      title: "Diabetes Self-Management",
      category: "diabetes",
      description: "Daily care for managing diabetes and blood sugar levels.",
      topics: ["Blood glucose monitoring", "Insulin administration", "Foot care", "Diet management"],
      readingLevel: "moderate"
    },
    {
      id: 5,
      title: "Preventing Falls at Home",
      category: "safety",
      description: "Keep yourself safe from falls with these home safety tips.",
      topics: ["Home modifications", "Exercise for balance", "Medication review", "Proper footwear"],
      readingLevel: "simple"
    },
    {
      id: 6,
      title: "Caring for Your Wound",
      category: "wound",
      description: "Proper wound care techniques to promote healing.",
      topics: ["Dressing changes", "Signs of infection", "Nutrition for healing", "When to call nurse"],
      readingLevel: "simple"
    },
    {
      id: 7,
      title: "Understanding Hospice Care",
      category: "hospice",
      description: "What to expect from hospice and comfort-focused care.",
      topics: ["Comfort measures", "Pain management", "Emotional support", "Family involvement"],
      readingLevel: "simple"
    },
    {
      id: 8,
      title: "Heart-Healthy Eating",
      category: "nutrition",
      description: "Dietary guidelines for a healthy heart.",
      topics: ["Low-sodium foods", "Reading labels", "Portion control", "Meal planning"],
      readingLevel: "simple"
    },
    {
      id: 9,
      title: "Medication Safety at Home",
      category: "safety",
      description: "Keep track of your medications safely.",
      topics: ["Pill organizers", "Avoiding interactions", "Storage tips", "Refill reminders"],
      readingLevel: "simple"
    },
    {
      id: 10,
      title: "Managing Pain at Home",
      category: "hospice",
      description: "Techniques for managing chronic and acute pain.",
      topics: ["Pain scales", "Medication timing", "Non-drug methods", "Communication"],
      readingLevel: "simple"
    },
    {
      id: 11,
      title: "Recovering from a Stroke",
      category: "stroke",
      description: "What to expect during stroke recovery and how to regain independence.",
      topics: ["Rehabilitation exercises", "Speech therapy tips", "Preventing another stroke", "Emotional recovery"],
      readingLevel: "simple"
    },
    {
      id: 12,
      title: "FAST: Stroke Warning Signs",
      category: "stroke",
      description: "Recognize and respond to stroke symptoms immediately.",
      topics: ["Face drooping", "Arm weakness", "Speech difficulty", "Time to call 911"],
      readingLevel: "simple"
    },
    {
      id: 13,
      title: "Managing Depression & Anxiety at Home",
      category: "mental",
      description: "Coping strategies for mental health challenges during illness.",
      topics: ["Relaxation techniques", "Social connection", "Sleep hygiene", "When to seek help"],
      readingLevel: "simple"
    },
    {
      id: 14,
      title: "Caring for a Joint Replacement",
      category: "orthopedic",
      description: "Post-surgical care and exercises for hip or knee replacement recovery.",
      topics: ["Weight-bearing precautions", "Exercises", "Wound care", "Warning signs"],
      readingLevel: "simple"
    },
    {
      id: 15,
      title: "Understanding Chronic Kidney Disease (CKD)",
      category: "renal",
      description: "Learn how to protect your kidneys and manage CKD at home.",
      topics: ["Low-potassium diet", "Fluid restrictions", "Medication management", "Monitoring symptoms"],
      readingLevel: "moderate"
    },
    {
      id: 16,
      title: "Dialysis Care at Home",
      category: "renal",
      description: "Guidelines for peritoneal or home hemodialysis patients.",
      topics: ["Access site care", "Fluid management", "Diet restrictions", "Signs of complications"],
      readingLevel: "moderate"
    },
    {
      id: 17,
      title: "Warfarin (Blood Thinner) Safety",
      category: "medication",
      description: "How to take warfarin safely and avoid bleeding complications.",
      topics: ["INR monitoring", "Vitamin K foods", "Signs of bleeding", "Drug interactions"],
      readingLevel: "simple"
    },
    {
      id: 18,
      title: "Insulin Administration & Storage",
      category: "diabetes",
      description: "Step-by-step guide to safe insulin use.",
      topics: ["Injection technique", "Rotation sites", "Storage guidelines", "Hypoglycemia signs"],
      readingLevel: "simple"
    },
    {
      id: 19,
      title: "Understanding Atrial Fibrillation (AFib)",
      category: "cardiac",
      description: "What AFib is and how to manage symptoms safely at home.",
      topics: ["Heart rhythm basics", "Stroke risk", "Medication adherence", "Activity guidelines"],
      readingLevel: "simple"
    },
    {
      id: 20,
      title: "Post-Surgical Wound Care",
      category: "wound",
      description: "How to care for a surgical incision at home.",
      topics: ["Dressing changes", "Infection signs", "Activity restrictions", "Bathing guidelines"],
      readingLevel: "simple"
    },
    {
      id: 21,
      title: "Asthma Action Plan",
      category: "respiratory",
      description: "Using your asthma action plan to manage flare-ups.",
      topics: ["Green/yellow/red zones", "Rescue inhaler use", "Avoiding triggers", "Peak flow monitoring"],
      readingLevel: "simple"
    },
    {
      id: 22,
      title: "Healthy Eating with Diabetes",
      category: "nutrition",
      description: "A diabetes-friendly diet guide for managing blood sugar.",
      topics: ["Carbohydrate counting", "Glycemic index", "Meal planning", "Reading nutrition labels"],
      readingLevel: "simple"
    },
    {
      id: 23,
      title: "Understanding Your Medications",
      category: "medication",
      description: "General guide to taking multiple medications safely.",
      topics: ["Pill organizers", "Medication schedule", "Side effects", "Drug-food interactions"],
      readingLevel: "simple"
    },
    {
      id: 24,
      title: "Coping with Grief & Loss",
      category: "hospice",
      description: "Support for patients and families facing end-of-life.",
      topics: ["Stages of grief", "Self-care", "Community resources", "Supporting family members"],
      readingLevel: "simple"
    },
    {
      id: 25,
      title: "After a Hip Fracture",
      category: "orthopedic",
      description: "Recovery steps and safety measures following a hip fracture.",
      topics: ["Weight-bearing status", "Fall prevention", "Home modifications", "Therapy exercises"],
      readingLevel: "simple"
    },
    {
      id: 26,
      title: "Lymphedema Management",
      category: "wound",
      description: "Daily care to manage swelling caused by lymphedema.",
      topics: ["Compression garments", "Skin care", "Exercise", "Manual drainage basics"],
      readingLevel: "moderate"
    },
    {
      id: 27,
      title: "Sleep Hygiene & Fatigue Management",
      category: "mental",
      description: "Tips for improving sleep quality during recovery.",
      topics: ["Sleep schedule", "Bedroom environment", "Limiting stimulants", "Relaxation routines"],
      readingLevel: "simple"
    },
    {
      id: 28,
      title: "Low-Sodium Diet Guide",
      category: "nutrition",
      description: "How to reduce sodium to manage heart failure and blood pressure.",
      topics: ["2g sodium limit", "Hidden sodium in foods", "Label reading", "Cooking tips"],
      readingLevel: "simple"
    },
  ];

  const filteredTopics = educationTopics.filter(topic => {
    const matchesSearch = topic.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         topic.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         topic.topics.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === "all" || topic.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Suggest topics based on patient diagnosis
  const suggestedTopics = patient?.primary_diagnosis ? 
    educationTopics.filter(t => 
      t.title.toLowerCase().includes(patient.primary_diagnosis.toLowerCase()) ||
      t.topics.some(topic => patient.primary_diagnosis.toLowerCase().includes(topic.toLowerCase()))
    ).slice(0, 3) : [];

  const getCategoryIcon = (category) => {
    const cat = categories.find(c => c.id === category);
    const Icon = cat?.icon || BookOpen;
    return <Icon className="w-4 h-4" />;
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search education topics..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          
          {/* Category Pills */}
          <div className="flex flex-wrap gap-2 mt-4">
            {categories.map((cat) => {
              const Icon = cat.icon;
              return (
                <Badge
                  key={cat.id}
                  variant={selectedCategory === cat.id ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  <Icon className="w-3 h-3 mr-1" />
                  {cat.label}
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Suggested for Patient */}
      {suggestedTopics.length > 0 && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-green-800">
              📌 Suggested for {patient.first_name} ({patient.primary_diagnosis})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid md:grid-cols-3 gap-3">
              {suggestedTopics.map((topic) => (
                <Card 
                  key={topic.id} 
                  className="cursor-pointer hover:shadow-md transition-shadow border-green-300"
                  onClick={() => onSelectMaterial({ title: topic.title, topic: topic.title })}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2">
                      {getCategoryIcon(topic.category)}
                      <div>
                        <h4 className="font-medium text-sm">{topic.title}</h4>
                        <p className="text-xs text-slate-600 mt-1">{topic.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Topics */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTopics.map((topic) => (
          <Card 
            key={topic.id} 
            className="cursor-pointer hover:shadow-lg transition-all hover:border-blue-300"
            onClick={() => onSelectMaterial({ title: topic.title, topic: topic.title })}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getCategoryIcon(topic.category)}
                  <Badge variant="outline" className="text-xs">
                    {categories.find(c => c.id === topic.category)?.label}
                  </Badge>
                </div>
                <Badge className="bg-blue-100 text-blue-800 text-xs">
                  {topic.readingLevel}
                </Badge>
              </div>
              
              <h3 className="font-semibold text-slate-900 mb-2">{topic.title}</h3>
              <p className="text-sm text-slate-600 mb-3">{topic.description}</p>
              
              <div className="flex flex-wrap gap-1">
                {topic.topics.slice(0, 3).map((t, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs">
                    {t}
                  </Badge>
                ))}
                {topic.topics.length > 3 && (
                  <Badge variant="secondary" className="text-xs">
                    +{topic.topics.length - 3} more
                  </Badge>
                )}
              </div>
              
              <Button variant="ghost" size="sm" className="w-full mt-3 gap-2">
                Generate Material <ChevronRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredTopics.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center text-slate-500">
            <BookOpen className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <p>No topics found matching your search.</p>
            <p className="text-sm">Try a different search term or category.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}