import { Link, Navigate, Route, Routes } from 'react-router';
import { useAuth } from '@/lib/AuthContext';
import Patients from '@/pages/Patients';
import { Button } from '@/components/ui/button';
import IndependentSavedVisits from '@/components/visit/IndependentSavedVisits';

/** Actual application components, with only the accepted read contract mounted. */
export default function IndependentStagingWorkspace() {
  const { tenantContext, logout } = useAuth();
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white p-4">
        <div>
          <p className="font-semibold">PennSync · Independent staging</p>
          <p className="text-sm text-slate-600">{tenantContext?.agency?.name}</p>
          <p className="text-xs text-slate-500">Synthetic patient and saved-visit testing. Clinical editing is unavailable.</p>
        </div>
        <nav className="flex items-center gap-4" aria-label="Staging navigation">
          <Link to="/Patients" className="underline">Patients</Link>
          <Link to="/ClinicalDocumentation" className="underline">Clinical Notes</Link>
          <Button variant="outline" onClick={() => { void logout(); }}>Sign out</Button>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Navigate to="/Patients" replace />} />
        <Route path="/Patients" element={<Patients independentReadOnly />} />
        <Route path="/ClinicalDocumentation" element={<IndependentSavedVisits />} />
        <Route path="*" element={(
          <main className="p-6">
            <h1 className="text-xl font-semibold">This page is not available in this staging milestone</h1>
            <p className="my-3">Patient names and read-only saved visits are available.</p>
            <Link to="/Patients" className="underline">Return to patients</Link>
          </main>
        )} />
      </Routes>
    </>
  );
}
