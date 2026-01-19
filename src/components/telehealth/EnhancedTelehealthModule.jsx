import React, { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Video, VideoOff, Mic, MicOff, PhoneOff, Loader2, 
  MessageSquare, Share2, Monitor, MonitorOff, Send,
  FileText, Copy, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

export default function EnhancedTelehealthModule({ visitId, patientId, patientName, onEndCall }) {
  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localTrack, setLocalTrack] = useState(null);
  const [duration, setDuration] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [connectionQuality, setConnectionQuality] = useState('good');
  const [joinLink, setJoinLink] = useState('');
  
  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef(null);
  const startTimeRef = useRef(null);
  const screenTrackRef = useRef(null);

  useEffect(() => {
    let interval;
    if (room && startTimeRef.current) {
      interval = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [room]);

  useEffect(() => {
    // Generate patient join link
    const link = `${window.location.origin}${window.location.pathname}#/PatientTelehealth?visitId=${visitId}&patientId=${patientId}`;
    setJoinLink(link);
  }, [visitId, patientId]);

  const startCall = async () => {
    setIsConnecting(true);
    try {
      const { data } = await base44.functions.invoke('createTelehealthSession', {
        visitId,
        patientId,
        isPatient: false
      });

      if (!data?.token) {
        throw new Error('Failed to get access token');
      }

      const Video = (await import('https://cdn.jsdelivr.net/npm/twilio-video@2.28.1/+esm')).default;

      const connectedRoom = await Video.connect(data.token, {
        name: data.roomName,
        audio: true,
        video: { width: 1280, height: 720 },
        networkQuality: { local: 1, remote: 1 }
      });

      setRoom(connectedRoom);
      startTimeRef.current = Date.now();

      connectedRoom.localParticipant.videoTracks.forEach(publication => {
        if (localVideoRef.current && publication.track) {
          const trackElement = publication.track.attach();
          localVideoRef.current.innerHTML = '';
          localVideoRef.current.appendChild(trackElement);
          setLocalTrack(publication.track);
        }
      });

      connectedRoom.participants.forEach(addParticipant);
      connectedRoom.on('participantConnected', addParticipant);
      connectedRoom.on('participantDisconnected', removeParticipant);

      // Monitor connection quality
      connectedRoom.localParticipant.on('networkQualityLevelChanged', (quality) => {
        if (quality <= 2) setConnectionQuality('poor');
        else if (quality <= 3) setConnectionQuality('fair');
        else setConnectionQuality('good');
      });

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
    toast.success(`${participant.identity} joined`);
  };

  const removeParticipant = (participant) => {
    setParticipants(prev => prev.filter(p => p.sid !== participant.sid));
    toast.info(`${participant.identity} left`);
  };

  const attachTrack = (track) => {
    if (remoteVideosRef.current) {
      if (track.kind === 'video') {
        const trackElement = track.attach();
        trackElement.className = 'w-full h-full object-cover rounded-lg';
        remoteVideosRef.current.innerHTML = '';
        remoteVideosRef.current.appendChild(trackElement);
      }
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

  const toggleScreenShare = async () => {
    if (!room) return;

    if (isScreenSharing) {
      if (screenTrackRef.current) {
        room.localParticipant.unpublishTrack(screenTrackRef.current);
        screenTrackRef.current.stop();
        screenTrackRef.current = null;
      }
      setIsScreenSharing(false);
      toast.info('Screen sharing stopped');
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: 1920, height: 1080 }
        });
        const screenTrack = stream.getVideoTracks()[0];
        
        const Video = (await import('https://cdn.jsdelivr.net/npm/twilio-video@2.28.1/+esm')).default;
        const localVideoTrack = new Video.LocalVideoTrack(screenTrack);
        
        await room.localParticipant.publishTrack(localVideoTrack);
        screenTrackRef.current = localVideoTrack;
        setIsScreenSharing(true);
        toast.success('Screen sharing started');

        screenTrack.onended = () => {
          toggleScreenShare();
        };
      } catch (error) {
        console.error('Screen share error:', error);
        toast.error('Failed to share screen');
      }
    }
  };

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;

    const message = {
      sender: 'Provider',
      text: chatInput,
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, message]);
    setChatInput('');
    toast.success('Message sent');
  };

  const copyJoinLink = () => {
    navigator.clipboard.writeText(joinLink);
    toast.success('Patient join link copied');
  };

  const endCall = async () => {
    if (room) {
      room.disconnect();
      
      try {
        const { data } = await base44.functions.invoke('generateTelehealthSummary', {
          visitId,
          duration,
          chatMessages
        });

        await base44.entities.Visit.update(visitId, {
          telehealth_call_duration: duration,
          telehealth_shared_files: chatMessages
        });

        toast.success('Call ended. Summary generated.');
      } catch (error) {
        console.error('Failed to save summary:', error);
      }

      setRoom(null);
      if (onEndCall) onEndCall();
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getQualityColor = () => {
    switch (connectionQuality) {
      case 'poor': return 'bg-red-500';
      case 'fair': return 'bg-yellow-500';
      default: return 'bg-green-500';
    }
  };

  if (!room) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Telehealth Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-center py-6">
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

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-2">Patient Join Link:</p>
              <div className="flex gap-2">
                <Input value={joinLink} readOnly className="text-xs" />
                <Button onClick={copyJoinLink} variant="outline" size="icon">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Share this link with the patient to join the call
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="flex items-center gap-2">
                Telehealth - {patientName}
                <Badge className={`${getQualityColor()} text-white`}>
                  {connectionQuality}
                </Badge>
              </CardTitle>
              <div className="text-sm text-gray-600">
                {formatDuration(duration)}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="relative bg-gray-900 rounded-lg aspect-video">
                <div ref={remoteVideosRef} className="w-full h-full">
                  {participants.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-white">
                      Waiting for patient...
                    </div>
                  )}
                </div>
                <Badge className="absolute top-2 left-2 bg-black/50 text-white">
                  Patient
                </Badge>
              </div>

              <div className="relative bg-gray-900 rounded-lg aspect-video">
                <div ref={localVideoRef} className="w-full h-full">
                  {!isVideoEnabled && (
                    <div className="absolute inset-0 flex items-center justify-center text-white">
                      Camera Off
                    </div>
                  )}
                </div>
                <Badge className="absolute top-2 left-2 bg-black/50 text-white">
                  You
                </Badge>
              </div>
            </div>

            <div className="flex justify-center gap-3 flex-wrap">
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
                variant={isScreenSharing ? "default" : "outline"}
                size="icon"
                onClick={toggleScreenShare}
                className="rounded-full w-12 h-12"
              >
                {isScreenSharing ? <MonitorOff /> : <Monitor />}
              </Button>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowChat(!showChat)}
                className="rounded-full w-12 h-12"
              >
                <MessageSquare />
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
      </div>

      {showChat && (
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Chat</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3 h-96 overflow-y-auto mb-3">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className="text-sm">
                  <p className="font-semibold text-xs text-gray-500">{msg.sender}</p>
                  <p>{msg.text}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
              />
              <Button onClick={sendChatMessage} size="icon">
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}