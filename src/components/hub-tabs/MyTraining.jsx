// Thin route wrapper. The real UI lives in the shared embedded section
// component so it can also be rendered inside other pages (e.g. tabs/hubs).
import MyTrainingDashboard from "@/components/training/MyTrainingDashboard";

export default function MyTraining({ filterByType }) {
  return <MyTrainingDashboard filterByType={filterByType} />;
}
