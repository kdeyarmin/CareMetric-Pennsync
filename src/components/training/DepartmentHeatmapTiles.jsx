import '@/components/training/departmentHeatmap.css';
const bands = [
  { key: 'low', label: '0–<25%', color: 'bg-training-heat-low' },
  { key: 'watch', label: '25–<50%', color: 'bg-training-heat-watch' },
  { key: 'moderate', label: '50–<75%', color: 'bg-training-heat-moderate' },
  { key: 'high', label: '75–100%', color: 'bg-training-heat-high' },
];
export default function DepartmentHeatmapTiles({ departments }) {
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-label="Average progress color legend">
      <span>Lower progress</span>{bands.map(band => <span key={band.key} className="inline-flex items-center gap-1.5"><span className={`h-4 w-4 rounded border border-border ${band.color}`} aria-hidden="true" />{band.label}</span>)}<span>Higher progress</span>
    </div>
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Departments ordered by lowest average training progress">
      {departments.map(department => <li key={department.id} className={`flex min-h-40 flex-col rounded-xl border border-border p-4 text-foreground ${bands.find(band => band.key === department.band)?.color || 'bg-muted'} ${department.lowest ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : ''}`}>
        <div className="mb-3 min-h-5">{department.lowest && <span className="rounded bg-card/80 px-2 py-1 text-xs font-semibold text-foreground">Lowest average</span>}</div>
        <h3 className="text-base font-semibold text-foreground">{department.name}</h3>
        <strong className="mt-3 text-3xl">{department.progress}%</strong>
        <span className="text-xs">Average course progress</span>
        <span className="mt-3 text-xs">{department.assignments} course assignment{department.assignments === 1 ? '' : 's'}</span>
      </li>)}
    </ul>
  </div>;
}