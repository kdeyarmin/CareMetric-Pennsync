import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Loader2, CheckCircle2, AlertCircle, BookOpen, GripVertical,
} from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { linesToArray } from "@/utils";
import { useCourseContentBuilder } from "./useCourseContentBuilder";

// Lightweight local id for unsaved lessons/sections so React keys stay stable
// before a server id exists. Avoids Math.random (blocked in some envs) and Date.now.
let localSeq = 0;
const nextLocalId = () => `local-${localSeq++}`;

// Map a persisted TrainingModule.content_json into the editor's working shape.
// The editor only surfaces heading/body/bullets per section (plus intro and key
// takeaways), but AI-generated / seeded lessons carry much richer content the
// viewer renders (section example/pro_tip/warning/steps/do_dont/mnemonic/
// regulation_ref, plus top-level case_scenarios, self-checks, pearls, summary).
// We stash the raw content and raw section objects so a small edit doesn't erase
// everything we don't surface — see itemToContentJson.
export const moduleToItem = (module) => {
  const content = module.content_json || {};
  return {
    id: module.id,
    _localId: nextLocalId(),
    _rawContent: content,
    title: module.title || "",
    intro: content.intro || "",
    estimated_minutes: module.estimated_minutes || 10,
    is_required: module.is_required !== false,
    sections: (Array.isArray(content.sections) ? content.sections : []).map((s) => ({
      _localId: nextLocalId(),
      _raw: s,
      heading: s.heading || "",
      body: s.body || "",
      bulletsText: Array.isArray(s.bullets) ? s.bullets.join("\n") : "",
    })),
    takeawaysText: Array.isArray(content.key_takeaways) ? content.key_takeaways.join("\n") : "",
  };
};

const blankSection = () => ({ _localId: nextLocalId(), heading: "", body: "", bulletsText: "" });

const blankItem = () => ({
  _localId: nextLocalId(),
  title: "",
  intro: "",
  estimated_minutes: 10,
  is_required: true,
  sections: [blankSection()],
  takeawaysText: "",
});

// Serialize a working item back into TrainingModule content the player/viewer
// read. We merge the editor's fields ONTO the preserved raw content/sections so
// rich fields the editor doesn't surface survive an edit.
export const itemToContentJson = (item) => ({
  ...(item._rawContent || {}),
  intro: item.intro || "",
  sections: (item.sections || [])
    .filter((s) => s.heading || s.body || s.bulletsText || s._raw)
    .map((s) => ({
      ...(s._raw || {}),
      heading: s.heading || "",
      body: s.body || "",
      bullets: linesToArray(s.bulletsText),
    })),
  key_takeaways: linesToArray(item.takeawaysText),
});

// TrainingModule.category is a required enum distinct from the course category.
// Mirror the course category when it's a valid module category, else fall back.
const MODULE_CATEGORIES = new Set([
  "clinical", "documentation", "compliance", "safety", "technology", "specialty", "onboarding",
]);
const toModuleCategory = (courseCategory) =>
  MODULE_CATEGORIES.has(courseCategory) ? courseCategory : "compliance";

export default function CourseLessonBuilder({ courseId, courseCategory }) {
  // Serialize a lesson into the TrainingModule fields the player/viewer read.
  // category + module_type are required by the schema; title falls back to a
  // positional label.
  const toPayload = (item, index) => ({
    course_id: courseId,
    title: item.title || `Lesson ${index + 1}`,
    category: toModuleCategory(courseCategory),
    module_type: "ongoing",
    content_type: "text",
    content_json: itemToContentJson(item),
    order_index: index,
    estimated_minutes: Number(item.estimated_minutes) || 10,
    is_required: item.is_required !== false,
  });

  const { items, setItems, saving, saved, error, move, onDragEnd, saveAll } = useCourseContentBuilder({
    courseId,
    queryKey: ["training-modules", courseId],
    queryFn: () => base44.entities.TrainingModule.filter({ course_id: courseId }, "order_index", 100),
    entity: base44.entities.TrainingModule,
    toItem: moduleToItem,
    toPayload,
    notReadyMessage: "Lessons are still loading. Please try again in a moment.",
    saveErrorMessage: "Failed to save lessons. Please try again.",
  });

  const updateItem = (localId, patch) =>
    setItems((prev) => prev.map((it) => (it._localId === localId ? { ...it, ...patch } : it)));

  const addSection = (localId) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === localId ? { ...it, sections: [...it.sections, blankSection()] } : it
      )
    );

  const updateSection = (itemId, sectionId, patch) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === itemId
          ? {
              ...it,
              sections: it.sections.map((s) => (s._localId === sectionId ? { ...s, ...patch } : s)),
            }
          : it
      )
    );

  const removeSection = (itemId, sectionId) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === itemId
          ? { ...it, sections: it.sections.filter((s) => s._localId !== sectionId) }
          : it
      )
    );

  if (!courseId) {
    return (
      <Alert className="border-slate-200 bg-slate-50">
        <AlertCircle className="w-4 h-4 text-slate-500" />
        <AlertDescription className="text-slate-600">
          Save the course details first, then add lessons.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Lessons are shown to learners in order before the quiz.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, blankItem()])}>
          <Plus className="w-4 h-4 mr-1" /> Add Lesson
        </Button>
      </div>

      {items.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <BookOpen className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500">No lessons yet. Add your first lesson.</p>
          </CardContent>
        </Card>
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="lessons">
          {(dropProvided) => (
            <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-4">
              {items.map((item, index) => (
                <Draggable key={item._localId} draggableId={item._localId} index={index}>
                  {(dragProvided, dragSnapshot) => (
                    <div ref={dragProvided.innerRef} {...dragProvided.draggableProps}>
                      <Card className={`border-slate-200 ${dragSnapshot.isDragging ? "shadow-lg ring-2 ring-blue-200" : ""}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
                              <span
                                {...dragProvided.dragHandleProps}
                                className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500"
                                aria-label="Drag to reorder lesson"
                              >
                                <GripVertical className="w-4 h-4" />
                              </span>
                              Lesson {index + 1}
                            </span>
                            <div className="flex items-center gap-1">
                              <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)}>
                                <ChevronUp className="w-4 h-4" />
                              </Button>
                              <Button type="button" variant="ghost" size="sm" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                                <ChevronDown className="w-4 h-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setItems((prev) => prev.filter((it) => it._localId !== item._localId))}
                              >
                                <Trash2 className="w-4 h-4 text-red-600" />
                              </Button>
                            </div>
                          </div>

                          <div>
              <Label className="text-sm font-semibold">Lesson Title</Label>
              <Input
                value={item.title}
                onChange={(e) => updateItem(item._localId, { title: e.target.value })}
                placeholder="e.g. Hand Hygiene Basics"
                className="h-10 mt-1"
              />
            </div>

            <div>
              <Label className="text-sm font-semibold">Introduction</Label>
              <Textarea
                value={item.intro}
                onChange={(e) => updateItem(item._localId, { intro: e.target.value })}
                placeholder="Short intro shown at the top of the lesson"
                rows={2}
                className="mt-1"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Sections</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => addSection(item._localId)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Section
                </Button>
              </div>
              {item.sections.map((section, si) => (
                <div key={section._localId} className="rounded-xl border border-slate-100 p-3 space-y-2 bg-slate-50/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-400">Section {si + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSection(item._localId, section._localId)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </Button>
                  </div>
                  <Input
                    value={section.heading}
                    onChange={(e) => updateSection(item._localId, section._localId, { heading: e.target.value })}
                    placeholder="Section heading"
                    className="h-10"
                  />
                  <Textarea
                    value={section.body}
                    onChange={(e) => updateSection(item._localId, section._localId, { body: e.target.value })}
                    placeholder="Section content"
                    rows={3}
                  />
                  <div>
                    <Textarea
                      value={section.bulletsText}
                      onChange={(e) => updateSection(item._localId, section._localId, { bulletsText: e.target.value })}
                      placeholder="Optional bullet points, one per line"
                      rows={2}
                    />
                    <p className="text-xs text-slate-400 mt-1">One bullet per line (optional).</p>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <Label className="text-sm font-semibold">Key Takeaways</Label>
              <Textarea
                value={item.takeawaysText}
                onChange={(e) => updateItem(item._localId, { takeawaysText: e.target.value })}
                placeholder="One takeaway per line"
                rows={2}
                className="mt-1"
              />
            </div>

            <div className="w-40">
              <Label className="text-sm font-semibold">Est. Minutes</Label>
              <Input
                type="number"
                min="1"
                value={item.estimated_minutes}
                onChange={(e) => updateItem(item._localId, { estimated_minutes: e.target.value })}
                className="h-10 mt-1"
              />
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button type="button" onClick={saveAll} disabled={saving}>
          {saving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
          ) : (
            "Save Lessons"
          )}
        </Button>
        {saved && !saving && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="w-4 h-4" /> Lessons saved
          </span>
        )}
      </div>
    </div>
  );
}
