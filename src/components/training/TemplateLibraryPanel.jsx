import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const templates = [
  { name: 'HIPAA', topic: 'HIPAA and patient privacy', training_category: 'compliance', purpose_of_training: 'Reinforce privacy and confidentiality basics.', audience_roles: ['clinical staff', 'office staff'] },
  { name: 'Infection Control', topic: 'Infection prevention and control', training_category: 'clinical', purpose_of_training: 'Review everyday infection prevention practices.', audience_roles: ['clinical staff'] },
  { name: 'Hand Hygiene', topic: 'Hand hygiene', training_category: 'safety', purpose_of_training: 'Reinforce clean hand practices.', audience_roles: ['clinical staff'] },
];

export default function TemplateLibraryPanel({ onUseTemplate }) {
  return (
    <Card>
      <CardHeader><CardTitle>Starter Templates</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {templates.map((template) => (
          <div key={template.name} className="rounded-xl border p-4 bg-white space-y-3">
            <p className="font-semibold text-slate-900">{template.name}</p>
            <p className="text-sm text-slate-500">{template.purpose_of_training}</p>
            <Button variant="outline" className="w-full" onClick={() => onUseTemplate?.(template)}>Use Template</Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}