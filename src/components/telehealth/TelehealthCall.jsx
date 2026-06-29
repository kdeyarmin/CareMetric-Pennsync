import { useState } from 'react';
import PreJoinDeviceCheck from './PreJoinDeviceCheck';
import VideoRoom from './VideoRoom';

// Composes the pre-join device check ("green room") with the live VideoRoom.
// Every entry point (staff page, patient panel, public patient link) renders
// this so the device-check step and call wiring stay in one place.
export default function TelehealthCall({
  roomName,
  identity,
  joinToken,
  role = 'patient',
  waitingMessage,
  onDisconnect,
  onParticipantListChange,
}) {
  const [devices, setDevices] = useState(null);

  if (!devices) {
    return <PreJoinDeviceCheck role={role} onJoin={setDevices} />;
  }

  return (
    <VideoRoom
      roomName={roomName}
      identity={identity}
      joinToken={joinToken}
      waitingMessage={waitingMessage}
      videoDeviceId={devices.videoDeviceId}
      audioDeviceId={devices.audioDeviceId}
      onDisconnect={onDisconnect}
      onParticipantListChange={onParticipantListChange}
    />
  );
}
