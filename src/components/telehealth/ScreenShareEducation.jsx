import React, { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Monitor, Download, AlertCircle, Maximize2 } from "lucide-react";
import { toast } from "sonner";

export default function ScreenShareEducation({ 
  onScreenShareStart, 
  onScreenShareStop,
  isScreenSharing = false 
}) {
  const [screenOptions, setScreenOptions] = useState(null);
  const [isLoadingShare, setIsLoadingShare] = useState(false);
  const screenPreviewRef = useRef(null);

  const educationMaterials = [
    {
      title: "Anatomy Diagrams",
      description: "Visual reference for patient education",
      icon: "📊"
    },
    {
      title: "Care Instructions",
      description: "Show step-by-step care procedures",
      icon: "📋"
    },
    {
      title: "Test Results",
      description: "Share lab results and imaging",
      icon: "📈"
    },
    {
      title: "Medication List",
      description: "Review current medications visually",
      icon: "💊"
    }
  ];

  const handleScreenShare = async () => {
    setIsLoadingShare(true);
    try {
      const displayMediaOptions = {
        video: {
          cursor: 'always',
          displaySurface: 'monitor'
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      setScreenOptions(stream);
      onScreenShareStart(stream);

      // Handle when user stops sharing from browser UI
      const videoTrack = stream.getVideoTracks()[0];
      videoTrack.addEventListener('ended', () => {
        stopScreenShare();
      });

      toast.success("Screen sharing started");
    } catch (error) {
      if (error.name !== 'NotAllowedError') {
        toast.error("Failed to share screen: " + error.message);
      }
    } finally {
      setIsLoadingShare(false);
    }
  };

  const stopScreenShare = () => {
    if (screenOptions) {
      screenOptions.getTracks().forEach(track => track.stop());
      setScreenOptions(null);
      onScreenShareStop();
      toast.success("Screen sharing stopped");
    }
  };

  const toggleScreenShare = () => {
    if (isScreenSharing) {
      stopScreenShare();
    } else {
      handleScreenShare();
    }
  };

  return (
    <Card className="border-purple-200">
      <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-purple-600" />
            Screen Sharing for Patient Education
          </span>
          {isScreenSharing && (
            <Badge className="bg-red-500">Live</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-6">
        {/* Share Status */}
        {isScreenSharing && (
          <Alert className="border-green-200 bg-green-50">
            <Maximize2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800 text-sm">
              Your screen is being shared with the patient. They can see everything on your screen.
            </AlertDescription>
          </Alert>
        )}

        {/* Screen Share Toggle */}
        <Button
          onClick={toggleScreenShare}
          disabled={isLoadingShare}
          className={`w-full ${
            isScreenSharing
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-purple-600 hover:bg-purple-700'
          }`}
          size="lg"
        >
          <Monitor className="w-4 h-4 mr-2" />
          {isLoadingShare
            ? 'Starting...'
            : isScreenSharing
            ? 'Stop Sharing Screen'
            : 'Share Screen for Education'}
        </Button>

        {/* Education Materials Guide */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Suggested Education Materials to Share:
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {educationMaterials.map((material, idx) => (
              <div
                key={idx}
                className="border rounded-lg p-3 bg-gray-50 hover:bg-gray-100 transition"
              >
                <p className="text-xl mb-1">{material.icon}</p>
                <p className="text-xs font-medium text-gray-900">{material.title}</p>
                <p className="text-xs text-gray-600">{material.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Privacy Warning */}
        <Alert className="border-yellow-200 bg-yellow-50">
          <AlertCircle className="w-4 h-4 text-yellow-600" />
          <AlertDescription className="text-yellow-800 text-sm">
            <strong>Privacy Reminder:</strong> Before sharing your screen, close any sensitive windows, 
            notifications, or other patient information not related to this appointment.
          </AlertDescription>
        </Alert>

        {/* Tips */}
        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
          <h4 className="text-xs font-semibold text-blue-900 mb-2">Screen Sharing Tips:</h4>
          <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
            <li>Share specific applications rather than entire screen when possible</li>
            <li>Use larger fonts for better visibility</li>
            <li>Move slowly when pointing at items on screen</li>
            <li>Allow time for patient to absorb information</li>
            <li>Ask if they have questions about what they're seeing</li>
          </ul>
        </div>

        {/* Record Education Note */}
        <div>
          <p className="text-xs text-gray-600 mb-2">
            Document the education provided in your visit notes for the patient record.
          </p>
          <Button variant="outline" className="w-full" size="sm">
            <Download className="w-3 h-3 mr-2" />
            Add Education Item to Visit Notes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}