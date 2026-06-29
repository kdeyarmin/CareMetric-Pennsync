import { useRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RotateCcw, Check, X } from 'lucide-react';
import { toast } from 'sonner';

export default function DigitalSignaturePad({ onSave, onCancel, signerName }) {
  const sigPad = useRef(null);

  const clear = () => {
    sigPad.current?.clear();
  };

  const save = () => {
    if (sigPad.current?.isEmpty()) {
      toast.error('Please provide a signature');
      return;
    }
    const signatureData = sigPad.current.toDataURL();
    onSave(signatureData);
  };

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader>
        <CardTitle className="text-lg">Digital Signature</CardTitle>
        <p className="text-sm text-slate-600">
          By signing below, {signerName} confirms the accuracy of this discharge summary.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-2 border-slate-300 rounded-lg bg-white">
          <SignatureCanvas
            ref={sigPad}
            canvasProps={{
              className: 'w-full h-48 cursor-crosshair',
              style: { touchAction: 'none' }
            }}
            backgroundColor="white"
          />
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={clear}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={save}>
              <Check className="w-4 h-4 mr-2" />
              Confirm Signature
            </Button>
          </div>
        </div>

        <p className="text-xs text-slate-500 text-center">
          Date: {new Date().toLocaleString()} • IP: System
        </p>
      </CardContent>
    </Card>
  );
}