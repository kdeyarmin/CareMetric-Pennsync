import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const templates = [
  { name: 'Penn Hospice Annual Mandatory Education', business_line_scope: 'hospice', description: 'Starter annual plan for Penn Hospice staff.' },
  { name: 'Penn Home Health Annual Mandatory Education', business_line_scope: 'home_health', description: 'Starter annual plan for Penn Home Health staff.' },
  { name: 'Penn Office Staff Annual Mandatory Education', business_line_scope: 'all', description: 'Starter annual plan for Penn office staff.' },
  { name: 'Penn New Hire Orientation', business_line_scope: 'all', description: 'Starter orientation plan for new Penn employees.' },
  { name: 'Penn Clinical Staff Annual Competencies', business_line_scope: 'all', description: 'Starter competency plan for Penn clinical staff.' },
  { name: 'Penn Field Staff Safety Bundle', business_line_scope: 'all', description: 'Starter safety bundle for field teams.' },
];

export default function AnnualLearningPlanPanel({ plans = [], courses = [], year, onRefresh }) {
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedCourses, setSelectedCourses] = useState([]);
  const [planDraft, setPlanDraft] = useState({ name: `${year} Annual Mandatory Education`, business_line_scope: 'all', description: 'Annual education bundle' });
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);

  const createPlan = async () => {
    try {
      const created = await base44.entities.LearningPlan.create({ name: planDraft.name, description: planDraft.description, business_line_scope: planDraft.business_line_scope, year, plan_type: 'annual', active: true, auto_enroll: false, auto_enroll_criteria: {}, total_courses: 0 });
      setSelectedPlanId(created.id);
      onRefresh?.();
      toast.success("Learning plan created.");
    } catch {
      toast.error("Couldn't create the learning plan. Please try again.");
    }
  };

  const createStarterPlan = async (template) => {
    try {
      const created = await base44.entities.LearningPlan.create({ name: `${year} ${template.name}`, description: template.description, business_line_scope: template.business_line_scope, year, plan_type: 'annual', active: true, auto_enroll: false, auto_enroll_criteria: {}, total_courses: 0 });
      setSelectedPlanId(created.id);
      onRefresh?.();
      toast.success("Starter plan created.");
    } catch {
      toast.error("Couldn't create the starter plan. Please try again.");
    }
  };

  const savePlanCourses = async () => {
    if (!selectedPlan) return;
    try {
      const existing = await base44.entities.LearningPlanCourse.filter({ plan_id: selectedPlan.id }, 'order_index', 200);
      await Promise.all(existing.map((item) => base44.entities.LearningPlanCourse.delete(item.id)));
      await Promise.all(selectedCourses.map((courseId, index) => {
        const course = courses.find((item) => item.id === courseId);
        return base44.entities.LearningPlanCourse.create({ plan_id: selectedPlan.id, course_id: courseId, course_title: course?.title, order_index: index, is_required: true });
      }));
      await base44.entities.LearningPlan.update(selectedPlan.id, { total_courses: selectedCourses.length });
      onRefresh?.();
      toast.success("Plan courses saved.");
    } catch {
      toast.error("Couldn't save the plan courses. Please try again.");
    }
  };

  const duplicatePlan = async () => {
    if (!selectedPlan) return;
    try {
      const created = await base44.entities.LearningPlan.create({ name: `${selectedPlan.name} (Copy)`, description: selectedPlan.description, business_line_scope: selectedPlan.business_line_scope, year, plan_type: 'annual', active: true, auto_enroll: false, auto_enroll_criteria: {}, total_courses: selectedPlan.total_courses || 0 });
      const items = await base44.entities.LearningPlanCourse.filter({ plan_id: selectedPlan.id }, 'order_index', 200);
      await Promise.all(items.map((item, index) => base44.entities.LearningPlanCourse.create({ plan_id: created.id, course_id: item.course_id, course_title: item.course_title, order_index: index, is_required: item.is_required })));
      setSelectedPlanId(created.id);
      onRefresh?.();
      toast.success("Plan duplicated.");
    } catch {
      toast.error("Couldn't duplicate the plan. Please try again.");
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
      <Card>
        <CardHeader><CardTitle>Annual Learning Plans</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            {templates.map((template) => <Button key={template.name} variant="outline" className="justify-start" onClick={() => createStarterPlan(template)}>{template.name}</Button>)}
          </div>
          <Input value={planDraft.name} onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })} placeholder="Plan name" />
          <Input value={planDraft.business_line_scope} onChange={(e) => setPlanDraft({ ...planDraft, business_line_scope: e.target.value })} placeholder="Business line" />
          <Input value={planDraft.description} onChange={(e) => setPlanDraft({ ...planDraft, description: e.target.value })} placeholder="Description" />
          <Button className="w-full" onClick={createPlan}>Create annual plan</Button>
          {selectedPlan && <Button variant="outline" className="w-full" onClick={duplicatePlan}>Duplicate selected plan</Button>}
          <div className="space-y-2">{plans.filter((plan) => plan.plan_type === 'annual').map((plan) => <button key={plan.id} type="button" className={`w-full text-left rounded-xl border p-3 ${selectedPlanId === plan.id ? 'border-indigo-500 bg-indigo-50' : 'bg-white'}`} onClick={() => setSelectedPlanId(plan.id)}><p className="font-semibold text-slate-900">{plan.name}</p><p className="text-xs text-slate-500">{plan.business_line_scope} • {plan.total_courses || 0} courses</p></button>)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Plan Modules</CardTitle></CardHeader>
        <CardContent className="space-y-3 max-h-[720px] overflow-y-auto">
          {!selectedPlan ? <div className="text-sm text-slate-500">Select an annual plan to add required education items.</div> : courses.map((course) => <label key={course.id} htmlFor={`plan-course-${course.id}`} className="flex items-start gap-3 rounded-xl border p-4 bg-white"><Checkbox id={`plan-course-${course.id}`} checked={selectedCourses.includes(course.id)} onCheckedChange={() => setSelectedCourses((prev) => prev.includes(course.id) ? prev.filter((item) => item !== course.id) : [...prev, course.id])} /><div><p className="font-semibold text-slate-900">{course.title}</p><p className="text-sm text-slate-500">{course.business_line_scope || 'all'}</p></div></label>)}
          {selectedPlan && <Button className="w-full" onClick={savePlanCourses}>Save plan modules</Button>}
        </CardContent>
      </Card>
    </div>
  );
}