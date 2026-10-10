import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Printer } from "lucide-react";

// Read-only. The app receives no faxes (product owner, 2026-10-09): every fax
// that reaches the agency's Telnyx line is passed straight through to the
// office fax machine by handleTelnyxStatusWebhook. The former "Fax Receiving
// Control" switch wrote AgencySettings.fax_receiving_enabled, which the backend
// no longer honours, so offering it would be a control that changes nothing.
export default function InboundFaxRoutingNotice() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="w-5 h-5 text-slate-600" />
          Incoming Faxes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-600">
          Incoming faxes go to your office fax machine. The app does not receive or store faxes:
          a fax sent to the app&rsquo;s fax line is passed straight through to the office machine,
          and replies to faxes you send arrive there too.
        </p>
      </CardContent>
    </Card>
  );
}
