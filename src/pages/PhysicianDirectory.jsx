import PhysicianDirectory from '../components/physician/PhysicianDirectory';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import { BookUser } from 'lucide-react';

export default function PhysicianDirectoryPage() {
  return (
    <PageContainer>
      <PageHeader
        icon={BookUser}
        eyebrow="Communication"
        title="Provider Directory"
        description="Manage and search provider contact information"
        favoritePage="PhysicianDirectory"
      />
      <PhysicianDirectory mode="directory" />
    </PageContainer>
  );
}
