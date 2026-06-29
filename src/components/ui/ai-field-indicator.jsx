import { Badge } from "@/components/ui/badge";
import { Sparkles, AlertCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function AIFieldIndicator({
  confidence,
  source = "AI Generated",
  needsVerification = false,
  tooltip,
  showValue = false
}) {
  const hasConfidence = typeof confidence === "number" && !Number.isNaN(confidence);
  const roundedConfidence = hasConfidence ? Math.round(confidence) : null;

  if (needsVerification) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300 text-xs">
              <AlertCircle className="w-3 h-3 mr-1" />
              Verify
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{tooltip || "Please verify this AI-generated field"}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const confidenceColor = !hasConfidence
    ? "bg-slate-50 text-slate-700 border-slate-300"
    : roundedConfidence >= 90
    ? "bg-green-50 text-green-700 border-green-300"
    : roundedConfidence >= 70
    ? "bg-blue-50 text-blue-700 border-blue-300"
    : "bg-yellow-50 text-yellow-700 border-yellow-300";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={`${confidenceColor} text-xs`}>
            <Sparkles className="w-3 h-3 mr-1" />
            {source}{showValue && hasConfidence ? ` · ${roundedConfidence}%` : ""}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {tooltip || (hasConfidence ? `AI generated with ${roundedConfidence}% confidence` : "AI generated")}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}