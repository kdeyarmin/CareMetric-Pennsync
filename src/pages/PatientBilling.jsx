import React from "react";
import PatientBillingPortal from "../components/billing/PatientBillingPortal";

export default function PatientBilling() {
  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">My Billing</h1>
        <p className="text-gray-600">View your invoices and account balance</p>
      </div>

      <PatientBillingPortal />
    </div>
  );
}