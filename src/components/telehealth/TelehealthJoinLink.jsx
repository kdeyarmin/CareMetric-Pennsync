import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Video, Calendar, Clock, User } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function TelehealthJoinLink({ joinLink, visitData, patientName, isPatient = true }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [visit, setVisit] = useState(visitData);

  useEffect(() => {
    if (!visitData && joinLink?.includes('visitId=')) {
      const visitId = new URLSearchParams(joinLink.split('?')[1]).get('visitId');
      const fetchVisit = async () => {
        try {
          const visits = await base44.entities.Visit.filter({ id: visitId });
          if (visits.length > 0) setVisit(visits[0]);
        } catch (error) {
          console.error('Error fetching visit:', error);
        }
      };
      fetchVisit();
    }
  }, [joinLink, visitData]);

  const handleJoinCall = () => {
    if (joinLink) {
      window.open(joinLink, '_blank');
    }
  };

  return (
    <>
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Video className="w-5 h-5 text-blue-600" />
            Upcoming Telehealth Visit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {visit && (
            <>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-600" />
                <span className="text-sm">{new Date(visit.visit_date).toLocaleDateString()}</span>
              </div>
              {visit.visit_time && (
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-600" />
                  <span className="text-sm">{visit.visit_time}</span>
                </div>
              )}
            </>
          )}

          {patientName && (
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-gray-600" />
              <span className="text-sm">{patientName}</span>
            </div>
          )}

          <p className="text-sm text-gray-600">
            {isPatient 
              ? "Click the button below to join your telehealth visit" 
              : "Your patient can join the visit using the link provided"}
          </p>

          {isPatient ? (
            <Button 
              onClick={handleJoinCall} 
              className="w-full"
              disabled={!joinLink}
            >
              <Video className="w-4 h-4 mr-2" />
              Join Visit
            </Button>
          ) : (
            <Button 
              onClick={() => setDialogOpen(true)}
              variant="outline"
              className="w-full"
            >
              View Join Link
            </Button>
          )}
        </CardContent>
      </Card>

      {!isPatient && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Patient Join Link</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Share this link with the patient:</p>
              <div className="bg-gray-100 p-3 rounded font-mono text-xs break-all">
                {joinLink}
              </div>
              <Button 
                onClick={() => {
                  navigator.clipboard.writeText(joinLink);
                  alert('Link copied to clipboard');
                }}
                className="w-full"
              >
                Copy Link
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}