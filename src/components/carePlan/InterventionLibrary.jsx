import { useState } from "react";
import { Droppable, Draggable } from "@hello-pangea/dnd";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

export const INTERVENTIONS_LIBRARY = [
  {
    id: "wound-care",
    category: "Wound Care",
    dotColor: "bg-red-400",
    cardClass: "bg-red-50 border-red-200 text-red-800",
    items: [
      { id: "wc-1", name: "Wound Assessment", description: "Assess wound bed, size, depth, drainage and periwound skin", frequency: "Each visit", complianceTag: "OASIS M1340" },
      { id: "wc-2", name: "Dressing Change", description: "Perform sterile dressing change per physician order", frequency: "Per order", complianceTag: "Skilled nursing documentation" },
      { id: "wc-3", name: "Wound Irrigation", description: "Irrigate wound with prescribed solution per protocol", frequency: "Per order", complianceTag: "Document pre/post condition" },
      { id: "wc-4", name: "Debridement Assistance", description: "Assist with or perform wound debridement as ordered", frequency: "Per order", complianceTag: "Skilled nursing required" },
    ]
  },
  {
    id: "medication",
    category: "Medication Management",
    dotColor: "bg-blue-400",
    cardClass: "bg-blue-50 border-blue-200 text-blue-800",
    items: [
      { id: "mm-1", name: "Medication Reconciliation", description: "Review medications for accuracy, interactions and adherence", frequency: "Each visit", complianceTag: "SOC/ROC required" },
      { id: "mm-2", name: "High-Risk Med Teaching", description: "Educate on anticoagulants, insulin, digoxin using teach-back", frequency: "Per need", complianceTag: "Document teach-back" },
      { id: "mm-3", name: "Insulin Administration Teaching", description: "Teach proper insulin injection technique and rotation sites", frequency: "Per need", complianceTag: "Document return demo" },
      { id: "mm-4", name: "PRN Medication Management", description: "Assess need for and document PRN medication usage and effectiveness", frequency: "Each visit", complianceTag: "Document effectiveness" },
    ]
  },
  {
    id: "fall-prevention",
    category: "Fall Prevention",
    dotColor: "bg-amber-400",
    cardClass: "bg-amber-50 border-amber-200 text-amber-800",
    items: [
      { id: "fp-1", name: "Fall Risk Assessment", description: "Complete standardized fall risk tool (Morse/SBAR)", frequency: "Each visit", complianceTag: "OASIS M1910" },
      { id: "fp-2", name: "Home Safety Evaluation", description: "Assess home environment for fall hazards and recommend modifications", frequency: "SOC, PRN", complianceTag: "Document recommendations" },
      { id: "fp-3", name: "Ambulation Safety Teaching", description: "Teach safe ambulation with assistive devices", frequency: "Per need", complianceTag: "Document functional status" },
      { id: "fp-4", name: "Balance Exercise Program", description: "Instruct on safe strength and balance exercises to reduce fall risk", frequency: "Per need", complianceTag: "Document patient tolerance" },
    ]
  },
  {
    id: "cardiovascular",
    category: "Cardiovascular",
    dotColor: "bg-red-400",
    cardClass: "bg-red-50 border-red-200 text-red-800",
    items: [
      { id: "cv-1", name: "Blood Pressure Monitoring", description: "Monitor bilateral blood pressure and document trending", frequency: "Each visit", complianceTag: "Document trend" },
      { id: "cv-2", name: "Edema Assessment", description: "Assess and grade peripheral edema, location and characteristics", frequency: "Each visit", complianceTag: "OASIS M1340" },
      { id: "cv-3", name: "Fluid Management Teaching", description: "Educate on fluid restriction, daily weights and sodium limits", frequency: "Per need", complianceTag: "Document weight trend" },
      { id: "cv-4", name: "Cardiac Medication Compliance", description: "Assess adherence and side effects for cardiac medications", frequency: "Each visit", complianceTag: "Document med names" },
    ]
  },
  {
    id: "respiratory",
    category: "Respiratory",
    dotColor: "bg-navy-400",
    cardClass: "bg-navy-50 border-navy-200 text-navy-800",
    items: [
      { id: "resp-1", name: "Respiratory Assessment", description: "Auscultate lung sounds, assess breathing pattern and O2 sat", frequency: "Each visit", complianceTag: "OASIS M1400" },
      { id: "resp-2", name: "Inhaler Technique Teaching", description: "Evaluate and teach proper MDI/nebulizer technique", frequency: "Per need", complianceTag: "Document return demo" },
      { id: "resp-3", name: "Breathing Exercises", description: "Teach pursed lip and diaphragmatic breathing techniques", frequency: "Per need", complianceTag: "Document tolerance" },
      { id: "resp-4", name: "O2 Safety Education", description: "Educate patient/caregiver on safe home oxygen use", frequency: "Once, PRN", complianceTag: "Document education" },
    ]
  },
  {
    id: "diabetes",
    category: "Diabetes Management",
    dotColor: "bg-navy-400",
    cardClass: "bg-navy-50 border-navy-200 text-navy-800",
    items: [
      { id: "dm-1", name: "Blood Glucose Monitoring", description: "Monitor BG and assess for hypo/hyperglycemia signs", frequency: "Each visit", complianceTag: "Document values" },
      { id: "dm-2", name: "Diabetic Foot Care", description: "Inspect feet for lesions and teach proper foot hygiene", frequency: "Each visit", complianceTag: "OASIS M1340" },
      { id: "dm-3", name: "Diabetes Diet Education", description: "Educate on carbohydrate counting and diabetic meal planning", frequency: "Per need", complianceTag: "Document dietary recall" },
      { id: "dm-4", name: "Hypoglycemia Management", description: "Teach signs, symptoms and treatment of hypoglycemia", frequency: "Per need", complianceTag: "Document teach-back" },
    ]
  },
  {
    id: "education",
    category: "Patient Education",
    dotColor: "bg-green-400",
    cardClass: "bg-green-50 border-green-200 text-green-800",
    items: [
      { id: "pe-1", name: "Disease Process Education", description: "Educate patient/caregiver on primary diagnosis management", frequency: "Per need", complianceTag: "Document comprehension" },
      { id: "pe-2", name: "S&S to Report Teaching", description: "Teach signs/symptoms requiring immediate physician notification", frequency: "Each visit", complianceTag: "Emergency Action Plan" },
      { id: "pe-3", name: "Activity/Exercise Teaching", description: "Educate on safe activity levels and exercise program", frequency: "Per need", complianceTag: "Document limitations" },
      { id: "pe-4", name: "Nutrition Counseling", description: "Provide dietary guidance based on medical diagnosis", frequency: "Per need", complianceTag: "Document assessment" },
    ]
  },
  {
    id: "psychosocial",
    category: "Psychosocial",
    dotColor: "bg-indigo-400",
    cardClass: "bg-indigo-50 border-indigo-200 text-indigo-800",
    items: [
      { id: "ps-1", name: "Depression Screening", description: "Administer PHQ-2/PHQ-9 depression screening tool", frequency: "Per need", complianceTag: "OASIS M1730" },
      { id: "ps-2", name: "Caregiver Burden Assessment", description: "Assess caregiver stress and identify support needs", frequency: "Per need", complianceTag: "Document caregiver info" },
      { id: "ps-3", name: "Cognitive Assessment", description: "Assess orientation, memory and cognitive function", frequency: "Per need", complianceTag: "OASIS M1700-M1740" },
      { id: "ps-4", name: "Social Support Evaluation", description: "Assess support network and community resources", frequency: "Per need", complianceTag: "Document support system" },
    ]
  },
];

export function getCategoryForItem(itemId) {
  return INTERVENTIONS_LIBRARY.find(cat => cat.items.some(i => i.id === itemId));
}

export default function InterventionLibrary() {
  const [collapsed, setCollapsed] = useState({});

  const toggle = (id) => setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="w-60 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
      <div className="px-3 py-2.5 border-b bg-slate-50 flex-shrink-0">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Intervention Library</p>
        <p className="text-xs text-slate-400 mt-0.5">Drag items onto the plan</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {INTERVENTIONS_LIBRARY.map(category => (
          <div key={category.id} className="border-b border-slate-100 last:border-b-0">
            <button
              onClick={() => toggle(category.id)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 transition-colors"
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${category.dotColor}`} />
              <span className="text-xs font-semibold text-slate-700 flex-1 text-left">{category.category}</span>
              <span className="text-xs text-slate-400">{category.items.length}</span>
              {collapsed[category.id]
                ? <ChevronRight className="w-3 h-3 text-slate-400" />
                : <ChevronDown className="w-3 h-3 text-slate-400" />
              }
            </button>

            {!collapsed[category.id] && (
              <Droppable droppableId={`library-${category.id}`} isDropDisabled={true}>
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="pb-1 px-2">
                    {category.items.map((item, index) => (
                      <Draggable key={item.id} draggableId={item.id} index={index}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`mb-1.5 px-2 py-2 rounded-lg border text-left cursor-grab active:cursor-grabbing transition-all ${
                              snapshot.isDragging
                                ? 'shadow-xl ring-2 ring-indigo-400 bg-white scale-105'
                                : `${category.cardClass} hover:shadow-sm`
                            }`}
                          >
                            <div className="flex items-start gap-1.5">
                              <GripVertical className="w-3 h-3 mt-0.5 flex-shrink-0 opacity-40" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold leading-tight">{item.name}</p>
                                <p className="text-xs opacity-60 mt-0.5 leading-tight line-clamp-2">{item.description}</p>
                                <span className="inline-block mt-1 text-[10px] font-medium bg-white/50 rounded px-1 py-0.5 leading-none">
                                  {item.frequency}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}