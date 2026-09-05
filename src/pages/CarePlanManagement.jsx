import CarePlanUnavailable from '@/components/carePlan/CarePlanUnavailable';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';

export default function CarePlanManagement() {
  return (
    <PageContainer>
      <PageHeader
        title="Care Plans"
        description="Care-plan access is paused while tenant authorization is rebuilt."
      />
      <CarePlanUnavailable />
    </PageContainer>
  );
}
