import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PatientAppointmentBooking from "../components/scheduling/PatientAppointmentBooking";

export default function AppointmentBooking() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Schedule an Appointment</h1>
          <p className="text-gray-600">Choose a provider and time that works best for you</p>
        </div>

        <PatientAppointmentBooking />

        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-3">
              <div className="font-bold text-blue-600">1.</div>
              <div>
                <p className="font-semibold">Select a Provider</p>
                <p className="text-sm text-gray-600">Choose from available healthcare providers</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="font-bold text-blue-600">2.</div>
              <div>
                <p className="font-semibold">Pick a Date</p>
                <p className="text-sm text-gray-600">Select a date at least one day in advance</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="font-bold text-blue-600">3.</div>
              <div>
                <p className="font-semibold">Choose a Time</p>
                <p className="text-sm text-gray-600">Select from available appointment slots</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="font-bold text-blue-600">4.</div>
              <div>
                <p className="font-semibold">Receive Reminder</p>
                <p className="text-sm text-gray-600">Get an email reminder 24 hours before</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}