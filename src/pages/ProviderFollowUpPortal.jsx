import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ClipboardCheck, CheckCircle2, AlertTriangle, Send } from "lucide-react";
import LoadingState from "@/components/ui/LoadingState";

/**
 * Provider Follow-Up Portal — PUBLIC, token-gated page (routed pre-auth in
 * App.jsx like SignerPortal). A referring provider's office opens the link
 * from the faxed information-request form and answers each item as a
 * structured field — no fax-back required. Submission goes through the
 * token-authenticated submitFollowUpResponse backend function; the browser
 * never touches app entities. Single-use: the link deactivates on submit.
 *
 * The payload is scoped by the backend to the request items and minimal
 * patient identifiers — no chart data and no payment/coding mechanics.
 */
export default function ProviderFollowUpPortal() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState({ phase: "loading" }); // loading | invalid | ready | submitting | done
  const [request, setRequest] = useState(null);
  const [answers, setAnswers] = useState({});
  const [completedBy, setCompletedBy] = useState("");
  const [credential, setCredential] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState({ phase: "invalid", message: "This link is missing its access token." });
      return undefined;
    }
    base44.functions
      .invoke("validateFollowUpToken", { token })
      .then(({ data }) => {
        if (cancelled) return;
        if (!data?.valid) {
          setState({ phase: "invalid", message: data?.error || "This link is not valid." });
        } else if (data.already_submitted || data.request_status === "received") {
          setState({ phase: "done", alreadySubmitted: true });
          setRequest(data);
        } else {
          setRequest(data);
          setState({ phase: "ready" });
        }
      })
      .catch((err) => {
        if (!cancelled) setState({ phase: "invalid", message: err?.response?.data?.error || "Unable to open this request. Please try again or contact the agency." });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const openItems = (request?.items || []).filter((it) => it.item_status === "open");
  const answeredCount = openItems.filter((it) => (answers[it.item_id] || "").trim()).length;

  const submit = async () => {
    setError("");
    const responses = openItems
      .map((it) => ({ item_id: it.item_id, response_text: (answers[it.item_id] || "").trim() }))
      .filter((r) => r.response_text);
    if (responses.length === 0) {
      setError("Please answer at least one item before submitting.");
      return;
    }
    setState({ phase: "submitting" });
    try {
      const { data } = await base44.functions.invoke("submitFollowUpResponse", {
        token,
        responses,
        completed_by: completedBy,
        credential,
      });
      if (data?.success) {
        setState({ phase: "done", answered: data.answered });
      } else {
        setError(data?.error || "Submission failed. Please try again.");
        setState({ phase: "ready" });
      }
    } catch {
      setError("Submission failed. Please try again or fax the form back instead.");
      setState({ phase: "ready" });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 text-navy-800">
            <ClipboardCheck className="w-7 h-7" />
            <h1 className="text-xl font-bold">Home Health Referral — Information Request</h1>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Secure response portal. Your answers go directly to the home health agency.
          </p>
        </div>

        {state.phase === "loading" && (
          <Card>
            <CardContent className="p-10 text-center">
              <LoadingState label="Opening your request…" className="py-0" />
            </CardContent>
          </Card>
        )}

        {state.phase === "invalid" && (
          <Card className="border-2 border-red-300">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <p className="text-slate-800 font-semibold mb-1">This link can't be opened</p>
              <p className="text-sm text-slate-600">{state.message}</p>
            </CardContent>
          </Card>
        )}

        {state.phase === "done" && (
          <Card className="border-2 border-green-300 bg-green-50">
            <CardContent className="p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-3" />
              <p className="text-green-900 font-semibold mb-1">
                {state.alreadySubmitted ? "This request was already completed" : "Thank you — responses sent"}
              </p>
              <p className="text-sm text-green-800">
                {state.alreadySubmitted
                  ? "The agency has received a response for this request. If you need to send corrections, please contact the agency directly."
                  : "The agency has been notified and will follow up if anything else is needed."}
              </p>
            </CardContent>
          </Card>
        )}

        {(state.phase === "ready" || state.phase === "submitting") && request && (
          <>
            <Card>
              <CardContent className="p-4 text-sm text-slate-700">
                <p>
                  <span className="font-semibold">Patient:</span> {request.patient_name || "—"}
                  {request.patient_dob ? ` · DOB ${request.patient_dob}` : ""}
                  {request.referral_date ? ` · Referral ${request.referral_date}` : ""}
                </p>
                <p className="mt-1 text-slate-600">
                  To admit this patient promptly and meet Medicare documentation requirements, please answer the
                  items below. Each one explains exactly what is needed and why.
                </p>
              </CardContent>
            </Card>

            {openItems.length === 0 && (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="p-6 text-center text-sm text-green-900">
                  <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                  Every item on this request has already been answered — nothing further is needed.
                  If you have corrections, please contact the agency directly.
                </CardContent>
              </Card>
            )}

            {openItems.map((it) => (
              <Card key={it.item_id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">#{it.number}</Badge>
                    {it.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-slate-800">{it.question}</p>
                  {it.hint && <p className="text-xs text-slate-500">{it.hint}</p>}
                  <p className="text-xs text-slate-500">
                    <span className="font-semibold">Why it's needed:</span> {it.why} ({it.citation})
                  </p>
                  {it.response_type === "document" && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                      This item asks for a document. Please describe it below and fax it to the agency, or paste the
                      relevant content here.
                    </p>
                  )}
                  <Textarea
                    value={answers[it.item_id] || ""}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [it.item_id]: e.target.value }))}
                    placeholder="Type your response…"
                    rows={3}
                  />
                </CardContent>
              </Card>
            ))}

            {openItems.length > 0 && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="pf-name" className="text-xs">Completed by (name)</Label>
                    <Input id="pf-name" value={completedBy} onChange={(e) => setCompletedBy(e.target.value)} placeholder="Jane Smith" />
                  </div>
                  <div>
                    <Label htmlFor="pf-cred" className="text-xs">Credential (MD, DO, RN, office staff…)</Label>
                    <Input id="pf-cred" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="MD" />
                  </div>
                </div>
                {error && (
                  <Alert className="bg-red-50 border-red-300">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
                  </Alert>
                )}
                <Button
                  type="button"
                  className="w-full bg-navy-600 hover:bg-navy-700 min-h-[44px]"
                  onClick={submit}
                  disabled={state.phase === "submitting"}
                >
                  <Send className="w-4 h-4 mr-2" />
                  {state.phase === "submitting"
                    ? "Sending…"
                    : `Send ${answeredCount || ""} response${answeredCount === 1 ? "" : "s"} to the agency`}
                </Button>
                <p className="text-xs text-slate-500 text-center">
                  This link is single-use: once submitted, answers can't be changed here. Items you leave blank can
                  still be faxed back on the paper form.
                </p>
              </CardContent>
            </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
