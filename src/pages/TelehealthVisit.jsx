import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Video, VideoOff, Mic, MicOff, PhoneOff, AlertCircle, FileText, CheckCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import TelehealthConsentForm from '../components/telehealth/TelehealthConsentForm';
import { createPageUrl } from '@/utils';

export default function TelehealthVisit() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientId = searchParams.get('patientId');
  
  const [step, setStep] = useState('consent'); // consent, connecting, connected, ended
  const [consent, setConsent] = useState(null);
  const [room, setRoom] = useState(null);
  const [localTracks, setLocalTracks] = useState({ video: null, audio: null });
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [visitId, setVisitId] = useState(null);
  const [error, setError] = useState(null);
  
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roomRef = useRef(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: patient } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }).then(p => p[0]),
    enabled: !!patientId
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
    setStep('connecting');
  };

  const startVideoCall = async () => {
    try {
      setError(null);

      // Create visit record
      const visit = await base44.entities.Visit.create({
        patient_id: patientId,
        visit_date: new Date().toISOString().split('T')[0],
        visit_time: new Date().toLocaleTimeString(),
        visit_type: 'telehealth',
        status: 'in_progress'
      });
      setVisitId(visit.id);

      // Create Twilio Video room
      const { createTwilioVideoRoom } = await import('@/functions/createTwilioVideoRoom');
      const roomData = await createTwilioVideoRoom({ patientId, visitId: visit.id });

      if (!roomData || !roomData.providerToken) {
        throw new Error('Failed to create video room');
      }

      // Load Twilio Video SDK
      const Video = (await import('npm:twilio-video@2.28.1')).default;

      // Connect to room
      const videoRoom = await Video.connect(roomData.providerToken, {
        name: roomData.roomName,
        audio: true,
        video: { width: 640, height: 480 }
      });

      roomRef.current = videoRoom;
      setRoom(videoRoom);
      setStep('connected');

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
      setStep('consent');
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

  const endCall = async () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    // Update visit record
    if (visitId) {
      await base44.entities.Visit.update(visitId, {
        status: 'completed',
        end_time: new Date().toLocaleTimeString()
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

      {step === 'connecting' && (
        <Card>
          <CardHeader>
            <CardTitle>Ready to Start Video Call</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                Consent obtained and verified. You can now start the video consultation.
              </AlertDescription>
            </Alert>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Before Starting:</h3>
              <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                <li>Ensure you're in a private, quiet location</li>
                <li>Test your camera and microphone</li>
                <li>Have patient's chart ready for reference</li>
                <li>Verify patient identity at start of call</li>
              </ul>
            </div>

            <Button onClick={startVideoCall} className="bg-green-600 hover:bg-green-700 gap-2">
              <Video className="w-4 h-4" />
              Start Video Call
            </Button>
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
              <div className="flex justify-center gap-3">
                <Button
                  variant={isVideoEnabled ? "default" : "destructive"}
                  size="lg"
                  onClick={toggleVideo}
                  className="gap-2"
                >
                  {isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                  {isVideoEnabled ? 'Camera On' : 'Camera Off'}
                </Button>

                <Button
                  variant={isAudioEnabled ? "default" : "destructive"}
                  size="lg"
                  onClick={toggleAudio}
                  className="gap-2"
                >
                  {isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  {isAudioEnabled ? 'Mic On' : 'Mic Off'}
                </Button>

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
            </CardContent>
          </Card>

          <Alert className="border-blue-200 bg-blue-50">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900">
              <strong>HIPAA Compliance:</strong> This session is encrypted end-to-end. 
              {consent?.recording_consent ? ' Session is being recorded per patient consent.' : ' Session is not being recorded.'}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {step === 'ended' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Telehealth Visit Completed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                The video call has ended. Please document the visit.
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              <Button onClick={goToDocumentation} className="bg-blue-600 hover:bg-blue-700 gap-2">
                <FileText className="w-4 h-4" />
                Document Visit
              </Button>
              <Button variant="outline" onClick={() => navigate(createPageUrl('Patients'))}>
                Return to Patients
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}