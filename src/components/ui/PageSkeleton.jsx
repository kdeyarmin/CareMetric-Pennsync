export function SkeletonBlock({ className = "" }) {
  return <div className={`bg-slate-200 rounded animate-pulse ${className}`} />;
}

export function AssessmentSkeleton() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3">
        <SkeletonBlock className="h-5 w-48" />
        <SkeletonBlock className="h-8 w-36 rounded-lg" />
        <div className="ml-auto flex items-center gap-2">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-9 w-32 rounded-lg" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left — sections */}
        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 flex items-center gap-3">
                <SkeletonBlock className="w-7 h-7 rounded" />
                <SkeletonBlock className="h-4 flex-1" />
                <SkeletonBlock className="h-3 w-20" />
              </div>
              <div className="p-4 space-y-2">
                {[1, 2, 3].map(j => (
                  <SkeletonBlock key={j} className={`h-10 rounded-lg ${j === 2 ? 'w-4/5' : 'w-full'}`} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Right — recommendations panel */}
        <div className="w-80 bg-white border-l border-slate-200 p-4 space-y-3">
          <SkeletonBlock className="h-8 w-full rounded-lg mb-4" />
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="h-3 w-56 mb-2" />
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="border border-slate-100 rounded-lg p-3 space-y-2">
              <SkeletonBlock className="h-3.5 w-3/4" />
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CardSkeleton({ rows = 3 }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 animate-pulse">
      <SkeletonBlock className="h-5 w-40" />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} className={`h-4 ${i % 2 === 0 ? 'w-full' : 'w-3/4'}`} />
      ))}
    </div>
  );
}