import CarePlanUnavailable from '@/components/carePlan/CarePlanUnavailable';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';

export default function CarePlanBuilder() {
  return (
    <PageContainer>
      <PageHeader
        title="Care Plan Builder"
        description="Care-plan creation is paused while tenant authorization is rebuilt."
      />
      <CarePlanUnavailable />
    </PageContainer>
  );
}
