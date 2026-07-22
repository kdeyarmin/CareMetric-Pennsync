import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function FaxRecipientFields({ recipient, onChange, enabled }) {
  const { data: recipients = [], isLoading } = useQuery({
    queryKey: ["fax-provider-recipients"],
    enabled,
    queryFn: async () => {
      const [physicians, contacts] = await Promise.all([
        base44.entities.Physician.list("full_name", 500),
        base44.entities.FaxContact.list("name", 500),
      ]);
      return [
        ...physicians.filter((p) => p.fax_number && p.is_active !== false).map((p) => ({ id: `physician:${p.id}`, name: p.full_name, fax: p.fax_number, organization: p.practice_name })),
        ...contacts.filter((c) => c.fax_number).map((c) => ({ id: `contact:${c.id}`, name: c.name, fax: c.fax_number, organization: c.organization || c.company })),
      ];
    },
  });

  const selectRecipient = (id) => {
    if (id === "manual") return onChange({ id, name: "", fax: "" });
    const selected = recipients.find((item) => item.id === id);
    if (selected) onChange(selected);
  };

  return <div className="space-y-4">
    <div className="space-y-2">
      <Label>Healthcare provider</Label>
      <Select value={recipient.id || ""} onValueChange={selectRecipient} disabled={isLoading}>
        <SelectTrigger><SelectValue placeholder={isLoading ? "Loading providers..." : "Select a provider or contact"} /></SelectTrigger>
        <SelectContent>
          {recipients.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.organization ? ` — ${item.organization}` : ""}</SelectItem>)}
          <SelectItem value="manual">Enter another recipient</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-2"><Label>Recipient name</Label><Input value={recipient.name || ""} onChange={(e) => onChange({ ...recipient, name: e.target.value, id: "manual" })} /></div>
      <div className="space-y-2"><Label>Fax number</Label><Input type="tel" placeholder="+1234567890" value={recipient.fax || ""} onChange={(e) => onChange({ ...recipient, fax: e.target.value, id: "manual" })} /></div>
    </div>
  </div>;
}