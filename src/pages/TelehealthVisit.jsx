import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Video, VideoOff, Mic, MicOff, PhoneOff, AlertCircle, FileText, CheckCircle, Monitor, Upload, MessageSquare } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { secureEntity } from '../components/security/SecureEntityWrapper';
import TelehealthConsentForm from '../components/telehealth/TelehealthConsentForm';
import AdvancedWaitingRoom from '../components/telehealth/AdvancedWaitingRoom';
import TelehealthFileSharing from '../components/telehealth/TelehealthFileSharing';
import TelehealthPostCallSummary from '../components/telehealth/TelehealthPostCallSummary';
import TelehealthMessaging from '../components/telehealth/TelehealthMessaging';
import ScreenShareEducation from '../components/telehealth/ScreenShareEducation';
import { createPageUrl } from '@/utils';

export default function TelehealthVisit() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientId = searchParams.get('patientId');
  
  const [step, setStep] = useState('consent'); // consent, waiting, connecting, connected, ended
  const [consent, setConsent] = useState(null);
  const [room, setRoom] = useState(null);
  const [localTracks, setLocalTracks] = useState({ video: null, audio: null });
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [visitId, setVisitId] = useState(null);
  const [error, setError] = useState(null);
  const [sharedFiles, setSharedFiles] = useState([]);
  const [callNotes, setCallNotes] = useState('');
  const [callDuration, setCallDuration] = useState(0);
  const [patientWaiting, setPatientWaiting] = useState(false);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roomRef = useRef(null);
  const screenTrackRef = useRef(null);
  const callStartTimeRef = useRef(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }).then(p => p[0]),
    enabled: !!patientId
  });

  const { data: appointment } = useQuery({
    queryKey: ['appointment', searchParams.get('appointmentId')],
    queryFn: () => base44.entities.Appointment.filter({ 
      id: searchParams.get('appointmentId') 
    }).then(a => a[0]),
    enabled: !!searchParams.get('appointmentId')
  });

  // Check for existing active consent
  useQuery({
    queryKey: ['telehealthConsent', patientId],
    queryFn: async () => {
      const consents = await base44.entities.TelehealthConsent.filter({
        patient_id: patientId,
        is_active: true
      });
      if (consents.length > 0) {
        setConsent(consents[0]);
        setStep('connecting');
      }
      return consents;
    },
    enabled: !!patientId
  });

  const handleConsentComplete = (newConsent) => {
    setConsent(newConsent);
    setStep('waiting');
  };

  useEffect(() => {
    let interval;
    if (step === 'connected' && callStartTimeRef.current) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
        setCallDuration(elapsed);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [step]);

  const startVideoCall = async () => {
    try {
      setError(null);
      setStep('connecting');

      // Create visit record with secure logging
      const visit = await secureEntity.create('Visit', {
        patient_id: patientId,
        visit_date: new Date().toISOString().split('T')[0],
        visit_time: new Date().toLocaleTimeString(),
        visit_type: 'telehealth',
        status: 'in_progress',
        nurse_notes: `Telehealth visit initiated. Consent ID: ${consent?.id}. Patient consented to ${consent?.consent_type} consultation.`
      });
      setVisitId(visit.id);

      // Create Twilio Video room with recording option
      const response = await base44.functions.invoke('createTwilioVideoRoom', {
        patientId,
        visitId: visit.id,
        enableRecording: consent?.recording_consent || false
      });

      const roomData = response.data;

      if (!roomData || !roomData.providerToken) {
        throw new Error('Failed to create video room');
      }

      // Load Twilio Video SDK
      const Video = (await import('npm:twilio-video@2.28.1')).default;

      // Connect to room
      const videoRoom = await Video.connect(roomData.providerToken, {
        name: roomData.roomName,
        audio: true,
        video: { width: 1280, height: 720 }
      });

      roomRef.current = videoRoom;
      setRoom(videoRoom);
      setStep('connected');
      callStartTimeRef.current = Date.now();

      if (consent?.recording_consent) {
        setIsRecording(true);
      }

      // Attach local tracks
      videoRoom.localParticipant.videoTracks.forEach(publication => {
        if (localVideoRef.current) {
          const track = publication.track;
          localVideoRef.current.appendChild(track.attach());
          setLocalTracks(prev => ({ ...prev, video: track }));
        }
      });

      // Handle remote participants
      videoRoom.on('participantConnected', participant => {
        console.log('Patient connected:', participant.identity);
        setPatientWaiting(false);
      });

      videoRoom.on('participantDisconnected', participant => {
        console.log('Patient disconnected:', participant.identity);
      });

      videoRoom.on('trackSubscribed', track => {
        if (track.kind === 'video' && remoteVideoRef.current) {
          remoteVideoRef.current.appendChild(track.attach());
        }
      });

      // Store patient URL for sharing
      console.log('Patient URL:', roomData.patientUrl);

    } catch (error) {
      console.error('Error starting video call:', error);
      setError(error.message);
      setStep('waiting');
    }
  };

  const toggleVideo = () => {
    if (localTracks.video) {
      if (isVideoEnabled) {
        localTracks.video.disable();
      } else {
        localTracks.video.enable();
      }
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  const toggleAudio = () => {
    if (roomRef.current) {
      roomRef.current.localParticipant.audioTracks.forEach(publication => {
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
    try {
      if (!isScreenSharing) {
        // Start screen sharing
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: false
        });

        const screenTrack = stream.getVideoTracks()[0];
        screenTrackRef.current = screenTrack;

        // Replace video track with screen track
        const videoPublication = Array.from(roomRef.current.localParticipant.videoTracks.values())[0];
        await videoPublication.track.stop();
        
        const newTrack = new (await import('npm:twilio-video@2.28.1')).default.LocalVideoTrack(screenTrack);
        await roomRef.current.localParticipant.unpublishTrack(videoPublication.track);
        await roomRef.current.localParticipant.publishTrack(newTrack);

        // Handle when user stops sharing via browser UI
        screenTrack.onended = () => {
          toggleScreenShare();
        };

        setIsScreenSharing(true);
      } else {
        // Stop screen sharing
        if (screenTrackRef.current) {
          screenTrackRef.current.stop();
          screenTrackRef.current = null;
        }

        // Restart camera
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const videoTrack = stream.getVideoTracks()[0];
        
        const Video = (await import('npm:twilio-video@2.28.1')).default;
        const newTrack = new Video.LocalVideoTrack(videoTrack);
        await roomRef.current.localParticipant.publishTrack(newTrack);

        setIsScreenSharing(false);
      }
    } catch (error) {
      console.error('Error toggling screen share:', error);
      setError('Failed to share screen');
    }
  };

  const handleFileShared = (file) => {
    setSharedFiles(prev => [...prev, file]);
  };

  const endCall = async () => {
    if (screenTrackRef.current) {
      screenTrackRef.current.stop();
    }
    
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    // Update visit record with secure logging
    if (visitId) {
      await secureEntity.update('Visit', visitId, {
        status: 'completed',
        end_time: new Date().toLocaleTimeString(),
        nurse_notes: (callNotes || 'No additional notes') + `\n\nTelehealth session completed. Duration: ${Math.floor(callDuration / 60)} min. ${isRecording ? 'Session was recorded with patient consent.' : 'Session not recorded.'}`
      });
    }

    setStep('ended');
  };

  const goToDocumentation = () => {
    navigate(createPageUrl('SmartNoteAssistant') + `?patientId=${patientId}&visitId=${visitId}`);
  };

  if (!patient) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>Loading patient information...</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Telehealth Visit</h1>
        <p className="text-gray-600">
          Patient: {patient.first_name} {patient.last_name}
        </p>
      </div>

      {error && (
        <Alert className="mb-6 border-red-200 bg-red-50">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-900">{error}</AlertDescription>
        </Alert>
      )}

      {step === 'consent' && (
        <TelehealthConsentForm patient={patient} onConsentComplete={handleConsentComplete} />
      )}

      {step === 'waiting' && (
        <AdvancedWaitingRoom
          patient={patient}
          provider={currentUser}
          appointment={appointment}
          onStart={startVideoCall}
          onCancel={() => navigate(createPageUrl('TelehealthDashboard'))}
        />
      )}

      {step === 'connecting' && (
        <Card>
          <CardHeader>
            <CardTitle>Connecting to Video Room...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'connected' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6">
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                {/* Remote video (patient) */}
                <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
                  <div ref={remoteVideoRef} className="w-full h-full" />
                  <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm">
                    Patient
                  </div>
                </div>

                {/* Local video (provider) */}
                <div className="relative bg-gray-900 rounded-lg overflow-hidden aspect-video">
                  <div ref={localVideoRef} className="w-full h-full" />
                  <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-sm">
                    You
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant={isVideoEnabled ? "default" : "destructive"}
                  size="lg"
                  onClick={toggleVideo}
                  className="gap-2"
                >
                  {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                  {isVideoEnabled ? 'Camera' : 'Camera Off'}
                </Button>

                <Button
                  variant={isAudioEnabled ? "default" : "destructive"}
                  size="lg"
                  onClick={toggleAudio}
                  className="gap-2"
                >
                  {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  {isAudioEnabled ? 'Mic' : 'Mic Off'}
                </Button>

                <Button
                  variant={isScreenSharing ? "secondary" : "outline"}
                  size="lg"
                  onClick={toggleScreenShare}
                  className="gap-2"
                >
                  <Monitor className="w-5 h-5" />
                  {isScreenSharing ? 'Stop Share' : 'Share Screen'}
                </Button>

                <TelehealthFileSharing visitId={visitId} onFileShared={handleFileShared} />

                <Button
                  variant="destructive"
                  size="lg"
                  onClick={endCall}
                  className="gap-2 bg-red-600 hover:bg-red-700"
                >
                  <PhoneOff className="w-5 h-5" />
                  End Call
                </Button>
              </div>

              {/* Call Info */}
              <div className="mt-4 flex justify-between items-center text-sm text-gray-600">
                <span>Duration: {Math.floor(callDuration / 60)}:{(callDuration % 60).toString().padStart(2, '0')}</span>
                {isRecording && (
                  <span className="flex items-center gap-1 text-red-600">
                    <span className="animate-pulse">●</span> Recording
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Alert className="border-blue-200 bg-blue-50">
              <AlertCircle className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900 text-sm">
                <strong>HIPAA Compliance:</strong> Encrypted end-to-end. 
                {consent?.recording_consent ? ' Recording enabled.' : ' Not recording.'}
              </AlertDescription>
            </Alert>

            <ScreenShareEducation 
              onScreenShareStart={(stream) => {
                // Screen share handling is in toggleScreenShare
              }}
              onScreenShareStop={() => {
                // Handle stop
              }}
              isScreenSharing={isScreenSharing}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Secure Messaging */}
            <TelehealthMessaging
              visitId={visitId}
              patientId={patientId}
              providerEmail={currentUser?.email}
              isActive={true}
            />

            {/* In-Call Notes */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Visit Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <textarea
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  placeholder="Take notes during the call..."
                  className="w-full px-3 py-2 border rounded-md text-sm"
                  rows={3}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {step === 'ended' && (
        <TelehealthPostCallSummary
          visitId={visitId}
          patient={patient}
          callDuration={callDuration}
          callNotes={callNotes}
          sharedFiles={sharedFiles}
          wasRecorded={isRecording}
          onDocumentVisit={goToDocumentation}
          onReturnToPatients={() => navigate(createPageUrl('Patients'))}
        />
      )}
    </div>
  );
}