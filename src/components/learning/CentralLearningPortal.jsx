import { BookOpen, GraduationCap, PenLine } from 'lucide-react';
import { PENNSYNC_LEARNING_URL, CENTRAL_COURSE_EDITOR_URL, CENTRAL_MY_LEARNING_URL } from '@/lib/centralLearning';

export default function CentralLearningPortal({ authoring = false }) {
  return <section className="mx-auto my-8 max-w-4xl rounded-xl border bg-white p-8 shadow-sm" aria-label="CareMetric central learning">
    <BookOpen className="mb-4 h-9 w-9 text-teal-700" aria-hidden="true" />
    <h1 className="mb-3 text-2xl font-semibold">{authoring ? 'Create courses in the Support Hub' : 'CareMetric learning'}</h1>
    <p className="mb-6 text-slate-600">The Support Hub brings courses, lessons, quizzes, and completion records together for every CareMetric app. Sign in there to continue.</p>
    <div className="flex flex-wrap gap-4">
      <a className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-5 py-3 font-medium text-white" href={PENNSYNC_LEARNING_URL}><BookOpen size={18} /> Browse courses</a>
      <a className="inline-flex items-center gap-2 rounded-lg border px-5 py-3" href={CENTRAL_MY_LEARNING_URL}><GraduationCap size={18} /> My learning</a>
      {authoring && <a className="inline-flex items-center gap-2 rounded-lg border px-5 py-3" href={CENTRAL_COURSE_EDITOR_URL}><PenLine size={18} /> Create course</a>}
    </div>
  </section>;
}
