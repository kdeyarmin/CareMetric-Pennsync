import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Award, Download, CheckCircle2 } from "lucide-react";
import { getAccessToken } from "@base44/sdk";
import { appParams } from "@/lib/app-params";
import { toast } from 'sonner';

export default function CompletionCertificate({ completion, module, userName }) {
  const handleDownload = async () => {
    try {
      // generateTrainingCertificate streams raw PDF bytes. base44.functions.invoke
      // routes through axios with a JSON responseType, which decodes/corrupts the
      // binary body. POST to the same function endpoint and read it as a blob so
      // the bytes stay intact.
      const { serverUrl, appId, token } = appParams;
      const accessToken = token || getAccessToken();
      const response = await fetch(
        `${serverUrl}/api/apps/${appId}/functions/generateTrainingCertificate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Id': String(appId),
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
          },
          body: JSON.stringify({
            nurse_name: userName,
            module_title: module.title,
            completion_date: completion.completion_date,
            score: completion.score,
            certificate_id: completion.id
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Certificate request failed (${response.status})`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Certificate_${module.title.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Error downloading certificate:', error);
      toast.error('Failed to generate certificate. Please try again.');
    }
  };

  return (
    <Card className="border-2 border-green-300 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardContent className="p-6">
        <div className="text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Award className="w-10 h-10 text-white" />
          </div>
          
          <div className="mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <h3 className="text-xl font-bold text-slate-900">Module Completed!</h3>
            <p className="text-sm text-slate-600 mt-1">{module.title}</p>
          </div>

          <div className="bg-white rounded-lg p-4 mb-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Completion Date:</span>
              <span className="font-medium">
                {new Date(completion.completion_date).toLocaleDateString()}
              </span>
            </div>
            {completion.score && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Score:</span>
                <span className="font-bold text-green-600">{completion.score}%</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Certificate ID:</span>
              <span className="font-mono text-xs">{completion.id?.slice(0, 8) || 'N/A'}</span>
            </div>
          </div>

          <Button
            onClick={handleDownload}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:opacity-90"
          >
            <Download className="w-4 h-4 mr-2" />
            Download Certificate
          </Button>
          
          <p className="text-xs text-slate-500 mt-3">
            This certificate can be used for continuing education records
          </p>
        </div>
      </CardContent>
    </Card>
  );
}