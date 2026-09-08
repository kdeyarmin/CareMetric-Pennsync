import CarePlanUnavailable from '@/components/carePlan/CarePlanUnavailable';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';

export default function AutomaticCarePlans() {
  return (
    <PageContainer>
      <PageHeader
        title="Automatic Care Plans"
        description="Automatic care-plan rules are paused pending tenant binding."
      />
      <CarePlanUnavailable />
    </PageContainer>
  );
}
