import React from "react";

export default function Dashboard() {
  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="mt-2">Welcome to CareMetric AI</p>
      
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <a href="/SmartNoteAssistant" className="p-6 bg-white rounded-lg shadow hover:shadow-md">
          <p className="font-medium">Create Note</p>
        </a>
        <a href="/Patients" className="p-6 bg-white rounded-lg shadow hover:shadow-md">
          <p className="font-medium">View Patients</p>
        </a>
        <a href="/Tasks" className="p-6 bg-white rounded-lg shadow hover:shadow-md">
          <p className="font-medium">My Tasks</p>
        </a>
        <a href="/DocumentGenerator" className="p-6 bg-white rounded-lg shadow hover:shadow-md">
          <p className="font-medium">Generate Doc</p>
        </a>
      </div>
    </div>
  );
}