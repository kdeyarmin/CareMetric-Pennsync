import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export default function InvoiceGenerator({ onInvoiceCreated }) {
  const [selectedPatient, setSelectedPatient] = useState("");
  const [selectedVisits, setSelectedVisits] = useState([]);
  const [selectedInsurance, setSelectedInsurance] = useState("");
  const [billingModel, setBillingModel] = useState("fee_for_service");
  const [loading, setLoading] = useState(false);

  const { data: patients } = useQuery({
    queryKey: ["patients"],
    queryFn: () => base44.entities.Patient.list(),
    initialData: []
  });

  const { data: visits } = useQuery({
    queryKey: ["visits", selectedPatient],
    queryFn: () => selectedPatient ? base44.entities.Visit.filter({ patient_id: selectedPatient }) : Promise.resolve([]),
    enabled: !!selectedPatient,
    initialData: []
  });

  const { data: insuranceProviders } = useQuery({
    queryKey: ["insuranceProviders"],
    queryFn: () => base44.entities.InsuranceProvider.list(),
    initialData: []
  });

  const handleGenerateInvoice = async () => {
    if (!selectedPatient || selectedVisits.length === 0) {
      alert('Please select a patient and at least one visit');
      return;
    }

    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('generateInvoice', {
        patientId: selectedPatient,
        visitIds: selectedVisits,
        insuranceProviderId: selectedInsurance || null,
        billingModel: billingModel
      });

      alert(`Invoice ${data.invoiceNumber} created successfully!`);
      setSelectedPatient("");
      setSelectedVisits([]);
      setSelectedInsurance("");
      onInvoiceCreated?.();
    } catch (error) {
      alert('Error generating invoice: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Invoice</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Patient</Label>
          <Select value={selectedPatient} onValueChange={setSelectedPatient}>
            <SelectTrigger>
              <SelectValue placeholder="Select a patient" />
            </SelectTrigger>
            <SelectContent>
              {patients.map(patient => (
                <SelectItem key={patient.id} value={patient.id}>
                  {patient.first_name} {patient.last_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedPatient && (
          <>
            <div>
              <Label>Select Visits to Invoice</Label>
              <div className="space-y-2 mt-2 max-h-64 overflow-y-auto border rounded p-3">
                {visits.length > 0 ? (
                  visits.map(visit => (
                    <div key={visit.id} className="flex items-center gap-2">
                      <Checkbox
                        id={visit.id}
                        checked={selectedVisits.includes(visit.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedVisits([...selectedVisits, visit.id]);
                          } else {
                            setSelectedVisits(selectedVisits.filter(id => id !== visit.id));
                          }
                        }}
                      />
                      <label className="text-sm cursor-pointer flex-1">
                        {visit.visit_date} - {visit.visit_type}
                      </label>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-500">No visits found for this patient</p>
                )}
              </div>
            </div>

            <div>
              <Label>Insurance Provider (Optional)</Label>
              <Select value={selectedInsurance} onValueChange={setSelectedInsurance}>
                <SelectTrigger>
                  <SelectValue placeholder="Select insurance or leave blank for self-pay" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Self-Pay</SelectItem>
                  {insuranceProviders.map(provider => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Billing Model</Label>
              <Select value={billingModel} onValueChange={setBillingModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fee_for_service">Fee for Service</SelectItem>
                  <SelectItem value="bundled">Bundled</SelectItem>
                  <SelectItem value="capitated">Capitated</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleGenerateInvoice} disabled={loading} className="w-full">
              {loading ? "Generating..." : `Generate Invoice (${selectedVisits.length} visit${selectedVisits.length !== 1 ? 's' : ''})`}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}