import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import TelehealthRoom from "../components/telehealth/TelehealthRoom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function TelehealthVisit() {
  const [searchParams] = useSearchParams();
  const [sessionEnded, setSessionEnded] = useState(false);

  const roomName = searchParams.get('telehealthRoom') || searchParams.get('room');
  const visitId = searchParams.get('visitId');
  const isProvider = searchParams.get('isProvider') === 'true';

  if (!roomName || !visitId) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gray-100">
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-600">Invalid telehealth session parameters</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sessionEnded) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gray-100">
        <Card>
          <CardHeader>
            <CardTitle>Session Ended</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p>Your telehealth visit has been completed and saved to the patient's record.</p>
            <Button onClick={() => window.history.back()}>Return</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TelehealthRoom
      roomName={roomName}
      isProvider={isProvider}
      visitId={visitId}
      onSessionEnd={() => setSessionEnded(true)}
    />
  );
}