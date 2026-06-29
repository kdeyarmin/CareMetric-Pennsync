// Thin route wrapper. The real UI lives in the shared embedded section
// component so it can also be rendered inside other pages (e.g. tabs/hubs).
import AnnualTranscriptCenter from "@/components/learning/AnnualTranscriptCenter";

export default function AnnualEducationTranscript() {
  return <AnnualTranscriptCenter />;
}
