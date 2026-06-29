// Thin route wrapper. The real UI lives in the shared embedded section
// component so it can also be rendered inside other pages (e.g. tabs/hubs).
import AnnualMandatoryEducationHub from "@/components/training/AnnualMandatoryEducationHub";

export default function AnnualMandatoryEducation() {
  return <AnnualMandatoryEducationHub />;
}
