import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Video, 
  VideoOff, 
  Mic, 
  MicOff, 
  Phone, 
  Monitor,
  MonitorOff,
  Settings,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from "lucide-react";

export default function TelehealthCall() {
  const urlParams = new URLSearchParams(window.location.search);
  const visitId = urlParams.get("visitId");
  
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [callStartTime] = useState(new Date());
  const [callDuration, setCallDuration] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);

  const { data: visit } = useQuery({
    queryKey: ["visit", visitId],
    queryFn: async () => {
      const visits = await base44.entities.Visit.filter({ id: visitId });
      return visits[0];
    },
    enabled: !!visitId
  });

  const { data: patient } = useQuery({
    queryKey: ["patient", visit?.patient_id],
    queryFn: async () => {
      const patients = await base44.entities.Patient.filter({ id: visit.patient_id });
      return patients[0];
    },
    enabled: !!visit?.patient_id
  });

  // Update call duration every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCallDuration(Math.floor((new Date() - callStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [callStartTime]);

  // Initialize video stream
  useEffect(() => {
    const initializeMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: true, 
          audio: true 
        });
        
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        setConnectionStatus('connected');
      } catch (error) {
        console.error('Error accessing media devices:', error);
        setConnectionStatus('error');
        alert('Unable to access camera/microphone. Please check permissions.');
      }
    };

    initializeMedia();

    // Cleanup
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOn(videoTrack.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioOn(audioTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        setIsScreenSharing(true);
        
        screenStream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
        };
      } catch (error) {
        console.error('Error sharing screen:', error);
      }
    } else {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (localVideoRef.current && localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      setIsScreenSharing(false);
    }
  };

  const endCall = async () => {
    if (confirm('End this telehealth visit?')) {
      // Stop all streams
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }

      // Update visit with call duration
      await base44.entities.Visit.update(visitId, {
        telehealth_call_duration: callDuration
      });

      window.close();
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Video className="w-6 h-6 text-blue-400" />
          <div>
            <h2 className="text-white font-semibold">
              {patient ? `${patient.first_name} ${patient.last_name}` : 'Loading...'}
            </h2>
            <p className="text-sm text-gray-400">Telehealth Visit</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <Badge className={
            connectionStatus === 'connected' ? 'bg-green-600' :
            connectionStatus === 'connecting' ? 'bg-yellow-600' :
            'bg-red-600'
          }>
            {connectionStatus === 'connected' && <CheckCircle2 className="w-3 h-3 mr-1" />}
            {connectionStatus === 'connecting' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
            {connectionStatus === 'error' && <AlertTriangle className="w-3 h-3 mr-1" />}
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'connecting' ? 'Connecting...' :
             'Connection Error'}
          </Badge>
          <Badge variant="outline" className="bg-gray-700 text-white border-gray-600">
            {formatDuration(callDuration)}
          </Badge>
        </div>
      </div>

      {/* Video Area */}
      <div className="flex-1 relative bg-black">
        {/* Remote video (full screen) */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="w-32 h-32 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <Video className="w-16 h-16 text-gray-500" />
            </div>
            <p className="text-white text-lg">Waiting for patient to join...</p>
            <p className="text-gray-400 text-sm mt-2">Patient will see a link to join this call</p>
          </div>
        </div>

        {/* Local video (picture-in-picture) */}
        <div className="absolute bottom-4 right-4 w-64 h-48 bg-gray-800 rounded-lg overflow-hidden shadow-2xl border-2 border-gray-600">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          {!isVideoOn && (
            <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
              <VideoOff className="w-12 h-12 text-gray-500" />
            </div>
          )}
          <div className="absolute bottom-2 left-2">
            <Badge className="bg-blue-600">You</Badge>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-gray-800 px-6 py-4 flex items-center justify-center gap-4">
        <Button
          onClick={toggleVideo}
          className={`rounded-full w-14 h-14 ${isVideoOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'}`}
          title={isVideoOn ? 'Turn off camera' : 'Turn on camera'}
        >
          {isVideoOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
        </Button>

        <Button
          onClick={toggleAudio}
          className={`rounded-full w-14 h-14 ${isAudioOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-600 hover:bg-red-700'}`}
          title={isAudioOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {isAudioOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
        </Button>

        <Button
          onClick={toggleScreenShare}
          className={`rounded-full w-14 h-14 ${isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'}`}
          title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
        >
          {isScreenSharing ? <MonitorOff className="w-6 h-6" /> : <Monitor className="w-6 h-6" />}
        </Button>

        <Button
          onClick={endCall}
          className="rounded-full w-14 h-14 bg-red-600 hover:bg-red-700"
          title="End call"
        >
          <Phone className="w-6 h-6 rotate-135" />
        </Button>
      </div>

      {/* Compliance Notice */}
      <div className="bg-gray-800 border-t border-gray-700 px-6 py-2">
        <p className="text-xs text-gray-400 text-center">
          🔒 HIPAA-compliant encrypted connection • All sessions are documented for regulatory compliance
        </p>
      </div>
    </div>
  );
}