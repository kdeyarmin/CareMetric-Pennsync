import { useNavigate } from 'react-router-dom';
import SignatureRequestCreator from '@/components/signer/SignatureRequestCreator';

export default function CreateSignatureRequest() {
  const navigate = useNavigate();

  return (
    <div className="space-y-4 sm:space-y-6">
      <SignatureRequestCreator onCancel={() => navigate('/DocumentHub')} />
    </div>
  );
}
