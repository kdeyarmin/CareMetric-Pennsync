// Thin route wrapper. The real UI lives in the shared embedded section
// component so it can also be rendered inside other pages (e.g. tabs/hubs).
import EmployeeTranscriptCenter from "@/components/learning/EmployeeTranscriptCenter";

export default function EmployeeTranscript() {
  return <EmployeeTranscriptCenter />;
}
