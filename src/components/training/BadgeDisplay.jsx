import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge as BadgeComponent } from "@/components/ui/badge";
import { Trophy, Star, Zap, Award, Target } from "lucide-react";

const BADGE_CONFIG = {
  first_note: {
    icon: Star,
    color: "bg-yellow-100 text-yellow-700",
    title: "First Step",
    description: "Completed your first Smart Note"
  },
  smart_notes_pro: {
    icon: Zap,
    color: "bg-blue-100 text-blue-700",
    title: "Smart Notes Pro",
    description: "Generated 50+ Smart Notes"
  },
  quick_learner: {
    icon: Target,
    color: "bg-green-100 text-green-700",
    title: "Quick Learner",
    description: "Completed 5 modules in one week"
  },
  perfect_compliance: {
    icon: Trophy,
    color: "bg-purple-100 text-purple-700",
    title: "Compliance Champion",
    description: "100% compliance score on documentation"
  },
  ai_enthusiast: {
    icon: Zap,
    color: "bg-pink-100 text-pink-700",
    title: "AI Enthusiast",
    description: "Used all major AI features"
  },
  training_master: {
    icon: Award,
    color: "bg-indigo-100 text-indigo-700",
    title: "Training Master",
    description: "Completed all certification paths"
  },
  consistent_performer: {
    icon: Target,
    color: "bg-teal-100 text-teal-700",
    title: "Consistent Performer",
    description: "30-day perfect usage streak"
  }
};

export default function BadgeDisplay({ badges = [], showDescription = true }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {badges.map((badge) => {
          const config = BADGE_CONFIG[badge.badge_type];
          if (!config) return null;
          
          const Icon = config.icon;
          
          return (
            <Card key={badge.id} className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="p-4 text-center space-y-2">
                <div className={`w-12 h-12 rounded-full ${config.color} flex items-center justify-center mx-auto`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-sm">{config.title}</h4>
                {showDescription && (
                  <p className="text-xs text-gray-600">{config.description}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      
      {badges.length === 0 && (
        <Card className="bg-gray-50">
          <CardContent className="p-8 text-center">
            <Trophy className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">Complete training modules to earn badges</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}