import { Link } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileSearch } from "lucide-react";

/**
 * Where OASIS PDFs are uploaded and analyzed: the OASIS Center's Analyze tab.
 *
 * No file is uploaded from this screen. The Analyze tab uploads the PDF and
 * saves the analysis through the OASIS record broker, which
 * stamps the author and the agency from the session and opens a linked chart
 * only under the shared OASIS chart-access rule — so this card sends the user
 * there rather than keeping a second, unauthorized upload path.
 */
export default function OASISUploadWidget() {
  return (
    <Card className="border-2 border-blue-200 bg-blue-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-blue-950">
          <FileSearch className="h-5 w-5 text-blue-700" aria-hidden="true" />
          Analyze an OASIS PDF
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-6 text-blue-900">
        <p>
          Upload a completed OASIS in the OASIS Center to check documentation accuracy and
          compliance, link it to the patient and turn findings into follow-up tasks.
        </p>
        <Button asChild className="w-full">
          <Link to="/OASISCenter?tab=analyze">Open the OASIS Analyzer</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
