import { Droppable, Draggable } from "@hello-pangea/dnd";
import { GripVertical, X, CheckCircle2, Info, Link } from "lucide-react";
import { getCategoryForItem } from "./InterventionLibrary";

const GOALS = [
  { id: "goal-1", label: "Wound Healing", color: "bg-red-100 border-red-300 text-red-700" },
  { id: "goal-2", label: "Medication Adherence", color: "bg-blue-100 border-blue-300 text-blue-700" },
  { id: "goal-3", label: "Fall Prevention", color: "bg-amber-100 border-amber-300 text-amber-700" },
  { id: "goal-4", label: "Cardiovascular Stability", color: "bg-red-100 border-red-300 text-red-700" },
  { id: "goal-5", label: "Functional Independence", color: "bg-green-100 border-green-300 text-green-700" },
  { id: "goal-6", label: "Symptom Management", color: "bg-navy-100 border-navy-300 text-navy-700" },
];

function CompliancePill({ tag }) {
  if (!tag) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">
      <CheckCircle2 className="w-2.5 h-2.5" />
      {tag}
    </span>
  );
}

function InterventionCard({ item, index, onRemove, onSelect, isSelected, linkedPathway }) {
  const category = getCategoryForItem(item.id);

  return (
    <Draggable draggableId={`plan-${item.id}`} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          onClick={() => onSelect(item)}
          className={`mb-2 rounded-xl border-2 bg-white transition-all cursor-pointer ${
            snapshot.isDragging
              ? 'shadow-2xl rotate-1 border-indigo-400 scale-105'
              : isSelected
              ? 'border-indigo-500 shadow-md ring-2 ring-indigo-300'
              : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          <div className="flex items-start gap-2 p-3">
            <div {...provided.dragHandleProps} className="mt-0.5 cursor-grab active:cursor-grabbing">
              <GripVertical className="w-4 h-4 text-slate-300 flex-shrink-0" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                  {category && (
                    <p className="text-xs text-slate-400 mt-0.5">{category.category}</p>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                  className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.description}</p>

              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[10px] font-medium bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                  {item.frequency}
                </span>
                <CompliancePill tag={item.complianceTag} />
                {linkedPathway && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">
                    <Link className="w-2.5 h-2.5" />
                    {linkedPathway}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  );
}

export default function CarePlanCanvas({ planItems, onRemove, onSelectItem, selectedItemId, linkedPathways }) {
  const hasItems = planItems.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      {/* Goal Tags */}
      <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex-shrink-0">
        <p className="text-xs font-semibold text-slate-500 mb-1.5">Care Goals</p>
        <div className="flex flex-wrap gap-1.5">
          {GOALS.map(g => (
            <span key={g.id} className={`text-xs font-medium border rounded-full px-2.5 py-1 ${g.color}`}>
              {g.label}
            </span>
          ))}
        </div>
      </div>

      {/* Drop zone */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-700">Plan Interventions</h3>
          {hasItems && (
            <span className="text-xs text-slate-400 bg-white border border-slate-200 rounded-full px-2.5 py-0.5">
              {planItems.length} added
            </span>
          )}
        </div>

        <Droppable droppableId="care-plan-canvas">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`min-h-64 rounded-2xl transition-all duration-200 ${
                snapshot.isDraggingOver
                  ? 'bg-indigo-50 border-2 border-dashed border-indigo-400 ring-2 ring-indigo-200'
                  : hasItems
                  ? 'bg-transparent'
                  : 'border-2 border-dashed border-slate-200 bg-white'
              }`}
            >
              {!hasItems && !snapshot.isDraggingOver && (
                <div className="flex flex-col items-center justify-center h-48 text-center px-6">
                  <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center mb-3">
                    <Info className="w-6 h-6 text-indigo-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-400">Drop interventions here</p>
                  <p className="text-xs text-slate-300 mt-1">Drag from the library on the left</p>
                </div>
              )}

              {planItems.map((item, index) => (
                <InterventionCard
                  key={`plan-${item.id}`}
                  item={item}
                  index={index}
                  onRemove={onRemove}
                  onSelect={onSelectItem}
                  isSelected={selectedItemId === item.id}
                  linkedPathway={linkedPathways?.[item.id]}
                />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>

        {hasItems && (
          <div className="mt-4 p-3 bg-green-50 rounded-xl border border-green-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
              <div>
                <p className="text-xs font-semibold text-green-800">
                  {planItems.filter(i => i.complianceTag).length}/{planItems.length} interventions have compliance tags
                </p>
                <p className="text-xs text-green-600 mt-0.5">Click any intervention to link pathways & review guidelines</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}