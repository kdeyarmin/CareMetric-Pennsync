import TelehealthWorkspace from "./TelehealthWorkspace";

export default function PatientTelehealthPanel({ patientId, patientName }) {
  return <TelehealthWorkspace patientId={patientId} patientName={patientName} />;
}