import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { ChevronRight, Home } from "lucide-react";
import { buildBreadcrumbs } from "@/lib/nav.manifest";

export default function Breadcrumbs({ currentPageName, customPath = [] }) {
  const generated = customPath.length > 0 ? customPath : buildBreadcrumbs(currentPageName);
  const breadcrumbs = generated.length > 0 ? generated : [{ label: currentPageName }];

  return (
    <nav className="mb-4 flex items-center space-x-1 overflow-x-auto py-2 text-sm text-slate-600">
      <Link
        to={createPageUrl("Dashboard")}
        className="flex flex-shrink-0 items-center transition-colors hover:text-navy-700"
      >
        <Home className="w-4 h-4" />
      </Link>

      {breadcrumbs.map((crumb, index) => (
        <div key={index} className="flex items-center gap-1">
          <ChevronRight className="w-4 h-4 flex-shrink-0 text-slate-400" />
          {crumb.page && index < breadcrumbs.length - 1 ? (
            <Link
              to={createPageUrl(crumb.page)}
              className="whitespace-nowrap transition-colors hover:text-navy-700"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className={`whitespace-nowrap ${index === breadcrumbs.length - 1 ? "font-medium text-slate-900" : ""}`}>
              {crumb.label}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}
