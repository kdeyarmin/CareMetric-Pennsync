import { Navigate } from 'react-router';

// The canonical chart is PatientDetails. Keep the retained legacy module inert
// as well as redirected so its lazy chunk cannot contain old direct entity
// reads if route construction changes later.
export default function ClinicalChart() {
  return <Navigate to="/Patients" replace />;
}
