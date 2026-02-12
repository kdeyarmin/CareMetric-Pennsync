import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, User, Stethoscope, Heart, ChevronDown, ChevronUp, Clock } from "lucide-react";

const SPEAKER_COLORS = {
  CLINICIAN_1: { bg: "bg-blue-50", border: "border-blue-300", text: "text-blue-800", badge: "bg-blue-600", icon: Stethoscope },
  CLINICIAN_2: { bg: "bg-indigo-50", border: "border-indigo-300", text: "text-indigo-800", badge: "bg-indigo-600", icon: Stethoscope },
  CLINICIAN_3: { bg: "bg-violet-50", border: "border-violet-300", text: "text-violet-800", badge: "bg-violet-600", icon: Stethoscope },
  PATIENT: { bg: "bg-green-50", border: "border-green-300", text: "text-green-800", badge: "bg-green-600", icon: User },
  FAMILY: { bg: "bg-orange-50", border: "border-orange-300", text: "text-orange-800", badge: "bg-orange-600", icon: Heart },
  OTHER: { bg: "bg-slate-50", border: "border-slate-300", text: "text-slate-800", badge: "bg-slate-600", icon: User },
};

function getColor(speaker) {
  return SPEAKER_COLORS[speaker] || SPEAKER_COLORS.OTHER;
}

export default function SpeakerDiarizationView({ speakerSegments = [], speakers = [], onSegmentClick }) {
  const [expanded, setExpanded] = useState(true);
  const [filterSpeaker, setFilterSpeaker] = useState(null);

  if (!speakerSegments || speakerSegments.length === 0) return null;

  const filteredSegments = filterSpeaker
    ? speakerSegments.filter(s => s.speaker === filterSpeaker)
    : speakerSegments;

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            Speaker Diarization
            <Badge variant="outline" className="text-xs ml-1">
              {speakers.length} speaker{speakers.length !== 1 ? 's' : ''}
            </Badge>
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>

        {/* Speaker summary pills */}
        <div className="flex flex-wrap gap-2 mt-2">
          <Button
            size="sm"
            variant={filterSpeaker === null ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilterSpeaker(null)}
          >
            All ({speakerSegments.length})
          </Button>
          {speakers.map((s) => {
            const color = getColor(s.label);
            const Icon = color.icon;
            return (
              <Button
                key={s.label}
                size="sm"
                variant={filterSpeaker === s.label ? "default" : "outline"}
                className="h-7 text-xs gap-1"
                onClick={() => setFilterSpeaker(filterSpeaker === s.label ? null : s.label)}
              >
                <Icon className="w-3 h-3" />
                {s.label.replace('_', ' ')}
                <span className="text-muted-foreground">({s.segmentCount})</span>
              </Button>
            );
          })}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {filteredSegments.map((segment, idx) => {
              const color = getColor(segment.speaker);
              const Icon = color.icon;
              return (
                <div
                  key={idx}
                  className={`flex gap-2 p-2 rounded-lg ${color.bg} border ${color.border} cursor-pointer hover:shadow-sm transition-shadow`}
                  onClick={() => onSegmentClick?.(segment)}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${color.badge} text-white`}>
                      <Icon className="w-3 h-3" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[10px] font-bold uppercase ${color.text}`}>
                        {segment.speaker.replace('_', ' ')}
                      </span>
                      {segment.timestamp && segment.timestamp !== '00:00' && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {segment.timestamp}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">{segment.text}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      )}
    </Card>
  );
}