import { Link, Navigate, Route, Routes } from 'react-router';
import { useAuth } from '@/lib/AuthContext';
import Patients from '@/pages/Patients';
import { Button } from '@/components/ui/button';

/** Actual application components, with only the accepted read contract mounted. */
export default function IndependentStagingWorkspace() {
  const { tenantContext, logout } = useAuth();
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white p-4">
        <div>
          <p className="font-semibold">PennSync · Independent staging</p>
          <p className="text-sm text-slate-600">{tenantContext?.agency?.name}</p>
          <p className="text-xs text-slate-500">Synthetic roster testing. Clinical workflows are unavailable.</p>
        </div>
        <Button variant="outline" onClick={() => { void logout(); }}>Sign out</Button>
      </header>
      <Routes>
        <Route path="/" element={<Navigate to="/Patients" replace />} />
        <Route path="/Patients" element={<Patients independentReadOnly />} />
        <Route path="*" element={(
          <main className="p-6">
            <h1 className="text-xl font-semibold">This page is not available in this staging milestone</h1>
            <p className="my-3">Only agency selection and synthetic patient names have been connected.</p>
            <Link to="/Patients" className="underline">Return to patients</Link>
          </main>
        )} />
      </Routes>
    </>
  );
}
