import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PatientTelehealthPage() {
  const [room, setRoom] = useState(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localTrack, setLocalTrack] = useState(null);
  const [visitId, setVisitId] = useState(null);
  const [patientId, setPatientId] = useState(null);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    setVisitId(params.get('visitId'));
    setPatientId(params.get('patientId'));
  }, []);

  const joinCall = async () => {
    if (!visitId || !patientId) {
      toast.error('Invalid join link');
      return;
    }

    setIsConnecting(true);
    try {
      const { data } = await base44.functions.invoke('createTelehealthSession', {
        visitId,
        patientId,
        isPatient: true
      });

      if (!data?.token) {
        throw new Error('Failed to get access token');
      }

      const Video = (await import('https://cdn.jsdelivr.net/npm/twilio-video@2.28.1/+esm')).default;

      const connectedRoom = await Video.connect(data.token, {
        name: data.roomName,
        audio: true,
        video: { width: 1280, height: 720 }
      });

      setRoom(connectedRoom);

      connectedRoom.localParticipant.videoTracks.forEach(publication => {
        if (localVideoRef.current && publication.track) {
          const trackElement = publication.track.attach();
          localVideoRef.current.innerHTML = '';
          localVideoRef.current.appendChild(trackElement);
          setLocalTrack(publication.track);
        }
      });

      connectedRoom.participants.forEach(participant => {
        participant.tracks.forEach(publication => {
          if (publication.isSubscribed && publication.track.kind === 'video') {
            const trackElement = publication.track.attach();
            trackElement.className = 'w-full h-full object-cover rounded-lg';
            remoteVideoRef.current.innerHTML = '';
            remoteVideoRef.current.appendChild(trackElement);
          }
        });

        participant.on('trackSubscribed', track => {
          if (track.kind === 'video' && remoteVideoRef.current) {
            const trackElement = track.attach();
            trackElement.className = 'w-full h-full object-cover rounded-lg';
            remoteVideoRef.current.innerHTML = '';
            remoteVideoRef.current.appendChild(trackElement);
          }
        });
      });

      connectedRoom.on('participantConnected', participant => {
        participant.tracks.forEach(publication => {
          if (publication.isSubscribed && publication.track.kind === 'video') {
            const trackElement = publication.track.attach();
            trackElement.className = 'w-full h-full object-cover rounded-lg';
            remoteVideoRef.current.innerHTML = '';
            remoteVideoRef.current.appendChild(trackElement);
          }
        });
      });

      toast.success('Connected to provider');
    } catch (error) {
      console.error('Failed to join call:', error);
      toast.error('Failed to join video call');
    } finally {
      setIsConnecting(false);
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

  const leaveCall = () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      toast.success('Call ended');
    }
  };

  if (!visitId || !patientId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">Invalid join link</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Join Telehealth Session</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center">
              <p className="text-gray-600 mb-6">
                Your healthcare provider is ready to see you
              </p>
              <Button 
                onClick={joinCall} 
                disabled={isConnecting}
                className="bg-green-600 hover:bg-green-700 w-full"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Joining...
                  </>
                ) : (
                  <>
                    <Video className="w-4 h-4 mr-2" />
                    Join Video Call
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="relative bg-black rounded-lg aspect-video">
            <div ref={remoteVideoRef} className="w-full h-full">
              <div className="absolute inset-0 flex items-center justify-center text-white">
                Provider
              </div>
            </div>
          </div>

          <div className="relative bg-black rounded-lg aspect-video">
            <div ref={localVideoRef} className="w-full h-full">
              {!isVideoEnabled && (
                <div className="absolute inset-0 flex items-center justify-center text-white">
                  Camera Off
                </div>
              )}
            </div>
            <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
              You
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-4">
          <Button
            variant={isVideoEnabled ? "outline" : "destructive"}
            size="icon"
            onClick={toggleVideo}
            className="rounded-full w-14 h-14 bg-white hover:bg-gray-100"
          >
            {isVideoEnabled ? <Video /> : <VideoOff />}
          </Button>
          
          <Button
            variant={isAudioEnabled ? "outline" : "destructive"}
            size="icon"
            onClick={toggleAudio}
            className="rounded-full w-14 h-14 bg-white hover:bg-gray-100"
          >
            {isAudioEnabled ? <Mic /> : <MicOff />}
          </Button>

          <Button
            variant="destructive"
            size="icon"
            onClick={leaveCall}
            className="rounded-full w-14 h-14"
          >
            <PhoneOff />
          </Button>
        </div>
      </div>
    </div>
  );
}