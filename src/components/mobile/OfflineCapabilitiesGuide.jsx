import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Info } from "lucide-react";

export default function OfflineCapabilitiesGuide({ isOnline }) {
  const capabilities = [
    {
      category: "Patient Access",
      available: [
        "View cached patient details",
        "Access vital signs history",
        "Review medication lists",
        "Check care plans"
      ],
      unavailable: [
        "Search all patients",
        "Add new patients",
        "Real-time patient updates"
      ]
    },
    {
      category: "Visit Documentation",
      available: [
        "Create visit notes",
        "Record vital signs",
        "Document assessments",
        "Save drafts locally"
      ],
      unavailable: [
        "AI note enhancement",
        "Compliance checking",
        "Voice dictation",
        "Real-time suggestions"
      ]
    },
    {
      category: "Data Sync",
      available: [
        "Auto-sync when online",
        "Manual sync trigger",
        "Conflict resolution",
        "Progress tracking"
      ],
      unavailable: [
        "Instant updates",
        "Live collaboration",
        "Remote data access"
      ]
    }
  ];

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="bg-blue-50">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="w-5 h-5 text-blue-600" />
          What Works Offline?
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {capabilities.map((cap, idx) => (
          <div key={idx} className="border-b last:border-b-0 pb-4 last:pb-0">
            <h4 className="font-semibold text-sm text-gray-900 mb-2">{cap.category}</h4>
            
            <div className="space-y-2">
              <div>
                <p className="text-xs text-green-700 font-medium mb-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Available Offline
                </p>
                <ul className="space-y-1">
                  {cap.available.map((item, i) => (
                    <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                      <span className="text-green-600 mt-0.5">✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs text-red-700 font-medium mb-1 flex items-center gap-1">
                  <XCircle className="w-3 h-3" />
                  Requires Connection
                </p>
                <ul className="space-y-1">
                  {cap.unavailable.map((item, i) => (
                    <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
                      <span className="text-red-500 mt-0.5">✗</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ))}

        {!isOnline && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
            <p className="text-xs text-orange-800 font-medium mb-1">💡 Offline Tips:</p>
            <ul className="text-xs text-orange-700 space-y-1">
              <li>• Keep notes brief, enhance online later</li>
              <li>• Download patients before going offline</li>
              <li>• Check sync status regularly</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}