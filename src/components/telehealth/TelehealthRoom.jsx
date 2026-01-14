import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Video, VideoOff, Mic, MicOff, PhoneOff, Share2, Monitor } from "lucide-react";

export default function TelehealthRoom({ roomName, isProvider = false, visitId, onSessionEnd }) {
  const [accessToken, setAccessToken] = useState(null);
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [callStartTime, setCallStartTime] = useState(null);
  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    const getToken = async () => {
      try {
        const { data } = await base44.functions.invoke('getTelehealthAccessToken', {
          roomName: roomName
        });
        setAccessToken(data.token);
        setCallStartTime(new Date());
      } catch (error) {
        console.error('Error getting access token:', error);
      }
    };
    getToken();
  }, [roomName]);

  useEffect(() => {
    if (!callStartTime) return;
    const interval = setInterval(() => {
      const duration = Math.floor((Date.now() - callStartTime) / 1000);
      setCallDuration(duration);
    }, 1000);
    return () => clearInterval(interval);
  }, [callStartTime]);

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = async () => {
    try {
      await base44.functions.invoke('endTelehealthSession', {
        visitId: visitId,
        roomSid: roomName,
        callDuration: callDuration,
        summary: `Telehealth call completed. Duration: ${formatDuration(callDuration)}`
      });
      onSessionEnd?.();
    } catch (error) {
      console.error('Error ending session:', error);
    }
  };

  if (!accessToken) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gray-100">
        <Card>
          <CardContent className="pt-6">
            <p>Connecting to video room...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-gray-900 flex flex-col">
      {/* Main Video Area */}
      <div className="flex-1 flex items-center justify-center relative">
        <div className="w-full h-full bg-black relative flex items-center justify-center">
          <p className="text-white text-center">
            Video stream will appear here<br/>
            (Twilio Video integration in progress)
          </p>
          
          {/* Call Duration Badge */}
          <div className="absolute top-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg font-semibold">
            {formatDuration(callDuration)}
          </div>
        </div>
      </div>

      {/* Control Bar */}
      <div className="bg-gray-800 border-t border-gray-700 p-4 flex justify-center gap-4">
        <Button
          size="icon"
          variant={videoEnabled ? "default" : "destructive"}
          className="rounded-full w-12 h-12"
          onClick={() => setVideoEnabled(!videoEnabled)}
        >
          {videoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </Button>

        <Button
          size="icon"
          variant={audioEnabled ? "default" : "destructive"}
          className="rounded-full w-12 h-12"
          onClick={() => setAudioEnabled(!audioEnabled)}
        >
          {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
        </Button>

        {isProvider && (
          <Button
            size="icon"
            variant="outline"
            className="rounded-full w-12 h-12 text-white border-white"
          >
            <Share2 className="w-5 h-5" />
          </Button>
        )}

        <Button
          size="icon"
          variant="destructive"
          className="rounded-full w-12 h-12"
          onClick={handleEndCall}
        >
          <PhoneOff className="w-5 h-5" />
        </Button>
      </div>

      {/* Info Bar */}
      <div className="bg-gray-900 border-t border-gray-700 p-3 text-center text-white text-sm">
        <p>{isProvider ? 'Provider' : 'Patient'} connected • Room: {roomName}</p>
      </div>
    </div>
  );
}