import React from "react";
import { safePercent } from "@/lib/safePercent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Clock, CheckCircle2 } from "lucide-react";

const educationalVideos = [
  {
    id: "1",
    title: "Home Health Nursing: OASIS Training - M1800",
    description: "Detailed breakdown of OASIS M1800 assessment for home health nurses",
    duration: "15:00",
    category: "OASIS",
    videoId: "NjnFTLpExws",
    priority: "high"
  },
  {
    id: "2",
    title: "2025 OASIS-E1 Training Series - Overview",
    description: "Latest OASIS-E1 updates and comprehensive training for home health clinicians",
    duration: "45:00",
    category: "OASIS",
    videoId: "RQos5WswF2g",
    priority: "high"
  },
  {
    id: "3",
    title: "OASIS Training - Conventions",
    description: "Foundational conventions essential for accurate OASIS assessment completion",
    duration: "12:00",
    category: "OASIS",
    videoId: "IZDeEOlfCD4",
    priority: "medium"
  },
  {
    id: "4",
    title: "Home Health Lunch and Learn - Homebound Documentation",
    description: "Critical documentation requirements for homebound status and compliance",
    duration: "60:00",
    category: "Documentation",
    videoId: "z50-BLT1QgQ",
    priority: "high"
  },
  {
    id: "5",
    title: "Face-to-Face Documentation Requirement for Home Health",
    description: "Understanding Medicare face-to-face requirements and proper documentation",
    duration: "30:00",
    category: "Documentation",
    videoId: "6dDYMaEsXmM",
    priority: "high"
  },
  {
    id: "6",
    title: "Infection Prevention in Home Care - Best Practices",
    description: "Essential infection control protocols and training for home health caregivers",
    duration: "20:00",
    category: "Safety",
    videoId: "Ff5cnbA11OM",
    priority: "medium"
  },
  {
    id: "7",
    title: "Home Health Bag Technique - Best Practice",
    description: "6-step bag technique following accepted standards of practice for infection control",
    duration: "8:00",
    category: "Safety",
    videoId: "T-oO-eZWO74",
    priority: "high"
  },
  {
    id: "8",
    title: "Home Care Bag Technique - BAYADA",
    description: "Proper bag technique demonstration for infection prevention in home care settings",
    duration: "5:00",
    category: "Safety",
    videoId: "MxM4sVnfYyY",
    priority: "high"
  },
  {
    id: "9",
    title: "Clinical Bag Technique - Fairview Home-Based Care",
    description: "Educational video demonstrating proper clinical bag technique and infection control best practices",
    duration: "10:00",
    category: "Safety",
    videoId: "RRV1hoAkkM4",
    priority: "medium"
  }
];

export default function EducationVideos() {
  const [completedVideos, setCompletedVideos] = React.useState([]);

  const handleVideoComplete = (videoId) => {
    if (!completedVideos.includes(videoId)) {
      setCompletedVideos([...completedVideos, videoId]);
    }
  };

  const categoryColors = {
    "OASIS": "bg-green-100 text-green-800",
    "Documentation": "bg-navy-100 text-navy-800",
    "Safety": "bg-red-100 text-red-800",
    "Clinical": "bg-indigo-100 text-indigo-800"
  };

  const totalVideos = educationalVideos.length;
  const completionPercentage = safePercent(completedVideos.length, totalVideos);

  const videosByCategory = educationalVideos.reduce((acc, video) => {
    if (!acc[video.category]) acc[video.category] = [];
    acc[video.category].push(video);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header with Progress */}
      <Card className="border-2 border-indigo-300 bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900">Educational Videos</h2>
              <p className="text-sm text-slate-600">Comprehensive training on OASIS, documentation, and infection control</p>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="bg-white rounded-lg p-4 border border-indigo-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Your Progress</span>
              <span className="text-sm font-bold text-indigo-600">{completedVideos.length} / {totalVideos} videos</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3">
              <div 
                className="bg-gradient-to-r from-indigo-500 to-navy-600 h-3 rounded-full transition-all duration-500"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Videos by Category */}
      {Object.entries(videosByCategory).map(([category, videos]) => (
        <div key={category} className="space-y-4">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            {category}
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {videos.map((video) => (
              <Card 
                key={video.id}
                className={`hover:shadow-lg transition-shadow ${
                  completedVideos.includes(video.id) ? 'border-green-300 bg-green-50' : ''
                } ${video.priority === 'high' ? 'border-l-4 border-l-indigo-500' : ''}`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <CardTitle className="text-base mb-2 flex items-center gap-2">
                        {completedVideos.includes(video.id) && (
                          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                        )}
                        <span>{video.title}</span>
                      </CardTitle>
                      <p className="text-sm text-slate-600 mb-2">{video.description}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={categoryColors[video.category] || "bg-slate-100 text-slate-800"}>
                          {video.category}
                        </Badge>
                        {video.priority === 'high' && (
                          <Badge className="bg-indigo-100 text-indigo-800">Priority</Badge>
                        )}
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Clock className="w-3 h-3" />
                          {video.duration}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                    <iframe
                      className="absolute top-0 left-0 w-full h-full rounded-lg"
                      src={`https://www.youtube.com/embed/${video.videoId}?rel=0`}
                      title={video.title}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                  
                  {!completedVideos.includes(video.id) && (
                    <button
                      onClick={() => handleVideoComplete(video.id)}
                      className="w-full mt-3 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Mark as Complete
                    </button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {/* Completion Message */}
      {completedVideos.length === totalVideos && (
        <Card className="border-2 border-green-300 bg-gradient-to-r from-green-50 to-emerald-50">
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Congratulations!</h3>
            <p className="text-slate-600">
              You've completed all educational videos. Keep up the great work!
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}