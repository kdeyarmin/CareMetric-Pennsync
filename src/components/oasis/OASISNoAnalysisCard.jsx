import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * Empty state shared by the OASIS review tabs (Clinical / Compliance /
 * Documentation) when they are opened without analysis data in router state —
 * previously an identical inline card in each. Links back to the analyzer.
 */
export default function OASISNoAnalysisCard() {
  return (
    <div className="p-6">
      <Card>
        <CardContent className="p-6">
          <p className="text-slate-600">No analysis data available. Please analyze an OASIS document first.</p>
          <Link to={createPageUrl("OASISAnalyzer")}>
            <Button className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Analyzer
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
