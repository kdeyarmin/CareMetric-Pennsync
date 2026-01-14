import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Video, Copy, Check } from "lucide-react";
import { useState as useStateHook } from "react";

export default function TelehealthInitiator({ visit, patient, onSessionStart }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [roomCreated, setRoomCreated] = useState(null);
  const [selectedServiceCode, setSelectedServiceCode] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [serviceCodes, setServiceCodes] = useState([]);

  React.useEffect(() => {
    const fetchServiceCodes = async () => {
      try {
        const codes = await base44.entities.ServiceCode.list();
        setServiceCodes(codes.filter(c => c.is_active));
      } catch (error) {
        console.error('Error fetching service codes:', error);
      }
    };
    fetchServiceCodes();
  }, []);

  const handleInitiateCall = async () => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('createTwilioVideoRoom', {
        patientId: patient.id,
        visitId: visit.id,
        serviceCodeId: selectedServiceCode || null
      });

      setRoomCreated(data);
      onSessionStart?.(data);
    } catch (error) {
      alert('Error creating video room: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const joinLink = roomCreated 
    ? `${window.location.origin}?telehealthRoom=${roomCreated.roomName}&patientId=${patient.id}&visitId=${visit.id}`
    : '';

  const copyJoinLink = () => {
    navigator.clipboard.writeText(joinLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <>
      <Button 
        onClick={() => setDialogOpen(true)} 
        className="gap-2"
      >
        <Video className="w-4 h-4" />
        Start Telehealth Call
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Initiate Telehealth Visit</DialogTitle>
          </DialogHeader>

          {!roomCreated ? (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold">Patient</label>
                <p className="text-sm text-gray-600">{patient.first_name} {patient.last_name}</p>
              </div>

              <div>
                <label className="text-sm font-semibold">Visit Type</label>
                <p className="text-sm text-gray-600">{visit.visit_type}</p>
              </div>

              <div>
                <label className="text-sm font-semibold mb-2 block">Service Code (for billing)</label>
                <Select value={selectedServiceCode} onValueChange={setSelectedServiceCode}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a service code" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceCodes.map(code => (
                      <SelectItem key={code.id} value={code.id}>
                        {code.code} - {code.name} (${code.default_price})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleInitiateCall} disabled={loading}>
                  {loading ? 'Creating room...' : 'Create Video Room'}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <Card className="bg-green-50 border-green-200">
                <CardContent className="pt-6">
                  <p className="text-green-800 font-semibold mb-2">✓ Video room created successfully</p>
                  <p className="text-sm text-green-700">Room: {roomCreated.roomName}</p>
                </CardContent>
              </Card>

              <div>
                <label className="text-sm font-semibold mb-2 block">Patient Join Link</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={joinLink}
                    readOnly
                    className="flex-1 px-3 py-2 border rounded text-sm"
                  />
                  <Button 
                    size="icon"
                    variant="outline"
                    onClick={copyJoinLink}
                  >
                    {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">Share this link with the patient</p>
              </div>

              <Button 
                className="w-full"
                onClick={() => {
                  window.open(`/telehealth/${roomCreated.roomName}?isProvider=true`, '_blank');
                }}
              >
                <Video className="w-4 h-4 mr-2" />
                Join Video Call
              </Button>

              <Button 
                variant="outline"
                className="w-full"
                onClick={() => {
                  setDialogOpen(false);
                  setRoomCreated(null);
                }}
              >
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}