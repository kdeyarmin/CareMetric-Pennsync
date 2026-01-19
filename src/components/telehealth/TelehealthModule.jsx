import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function TelehealthModule({ visitId, patientId, patientName, onEndCall }) {
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localTrack, setLocalTrack] = useState(null);
  const [duration, setDuration] = useState(0);
  
  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef(null);
  const startTimeRef = useRef(null);

  useEffect(() => {
    let interval;
    if (room && startTimeRef.current) {
      interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [room]);

  const startCall = async () => {
    setIsConnecting(true);
    try {
      // Get Twilio token from backend
      const { data } = await base44.functions.invoke('createTelehealthSession', {
        visitId,
        patientId
      });

      if (!data?.token) {
        throw new Error('Failed to get access token');
      }

      // Dynamically import Twilio Video SDK
      const Video = (await import('https://cdn.jsdelivr.net/npm/twilio-video@2.28.1/+esm')).default;

      // Connect to room
      const connectedRoom = await Video.connect(data.token, {
        name: data.roomName,
        audio: true,
        video: { width: 640, height: 480 }
      });

      setRoom(connectedRoom);
      startTimeRef.current = Date.now();

      // Attach local video
      connectedRoom.localParticipant.videoTracks.forEach(publication => {
        if (localVideoRef.current && publication.track) {
          const trackElement = publication.track.attach();
          localVideoRef.current.appendChild(trackElement);
          setLocalTrack(publication.track);
        }
      });

      // Handle existing participants
      connectedRoom.participants.forEach(addParticipant);

      // Handle new participants
      connectedRoom.on('participantConnected', addParticipant);
      connectedRoom.on('participantDisconnected', removeParticipant);

      toast.success('Connected to telehealth session');
    } catch (error) {
      console.error('Failed to start call:', error);
      toast.error('Failed to connect to video call');
    } finally {
      setIsConnecting(false);
    }
  };

  const addParticipant = (participant) => {
    setParticipants(prev => [...prev, participant]);

    participant.tracks.forEach(publication => {
      if (publication.isSubscribed) {
        attachTrack(publication.track);
      }
    });

    participant.on('trackSubscribed', attachTrack);
  };

  const removeParticipant = (participant) => {
    setParticipants(prev => prev.filter(p => p.sid !== participant.sid));
  };

  const attachTrack = (track) => {
    if (remoteVideosRef.current && track.kind === 'video') {
      const trackElement = track.attach();
      trackElement.className = 'w-full h-full object-cover rounded-lg';
      remoteVideosRef.current.appendChild(trackElement);
    }
  };

  const toggleVideo = () => {
    if (room && localTrack) {
      if (isVideoEnabled) {
        localTrack.disable();
      } else {
        localTrack.enable();
      }
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  const toggleAudio = () => {
    if (room) {
      room.localParticipant.audioTracks.forEach(publication => {
        if (isAudioEnabled) {
          publication.track.disable();
        } else {
          publication.track.enable();
        }
      });
      setIsAudioEnabled(!isAudioEnabled);
    }
  };

  const endCall = async () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      
      // Save call duration to visit
      try {
        await base44.entities.Visit.update(visitId, {
          telehealth_call_duration: duration
        });
      } catch (error) {
        console.error('Failed to save call duration:', error);
      }

      toast.success('Call ended');
      if (onEndCall) onEndCall();
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!room) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Telehealth Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-600 mb-4">
              Start a secure video call with {patientName}
            </p>
            <Button 
              onClick={startCall} 
              disabled={isConnecting}
              className="bg-green-600 hover:bg-green-700"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Video className="w-4 h-4 mr-2" />
                  Start Video Call
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle>Telehealth - {patientName}</CardTitle>
          <div className="text-sm text-gray-600">
            Duration: {formatDuration(duration)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Remote video */}
          <div className="relative bg-gray-900 rounded-lg aspect-video">
            <div ref={remoteVideosRef} className="w-full h-full">
              {participants.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-white">
                  Waiting for patient to join...
                </div>
              )}
            </div>
          </div>

          {/* Local video */}
          <div className="relative bg-gray-900 rounded-lg aspect-video">
            <div ref={localVideoRef} className="w-full h-full">
              {!isVideoEnabled && (
                <div className="absolute inset-0 flex items-center justify-center text-white">
                  Camera Off
                </div>
              )}
            </div>
            <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
              You
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex justify-center gap-4">
          <Button
            variant={isVideoEnabled ? "outline" : "destructive"}
            size="icon"
            onClick={toggleVideo}
            className="rounded-full w-12 h-12"
          >
            {isVideoEnabled ? <Video /> : <VideoOff />}
          </Button>
          
          <Button
            variant={isAudioEnabled ? "outline" : "destructive"}
            size="icon"
            onClick={toggleAudio}
            className="rounded-full w-12 h-12"
          >
            {isAudioEnabled ? <Mic /> : <MicOff />}
          </Button>

          <Button
            variant="destructive"
            size="icon"
            onClick={endCall}
            className="rounded-full w-12 h-12"
          >
            <PhoneOff />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}