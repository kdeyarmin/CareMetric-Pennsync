import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertCircle,
  FileText,
  Calendar,
  Phone,
  User,
  ClipboardCheck,
  Info,
  ChevronDown,
  ChevronUp
} from "lucide-react";

const ERROR_CATEGORIES = {
  DATA_FORMAT: {
    label: "Data Format",
    icon: FileText,
    color: "bg-orange-100 text-orange-800 border-orange-300",
    keywords: ["format", "invalid", "type", "parse"]
  },
  MISSING_REQUIRED: {
    label: "Missing Required Fields",
    icon: ClipboardCheck,
    color: "bg-red-100 text-red-800 border-red-300",
    keywords: ["required", "missing", "empty", "blank"]
  },
  VALIDATION_RULE: {
    label: "Validation Rule Violation",
    icon: AlertCircle,
    color: "bg-yellow-100 text-yellow-800 border-yellow-300",
    keywords: ["validation", "invalid", "must be", "should be", "rule"]
  },
  DATE_ERROR: {
    label: "Date Issues",
    icon: Calendar,
    color: "bg-navy-100 text-navy-800 border-navy-300",
    keywords: ["date", "dob", "admission", "future", "past"]
  },
  CONTACT_INFO: {
    label: "Contact Information",
    icon: Phone,
    color: "bg-blue-100 text-blue-800 border-blue-300",
    keywords: ["phone", "email", "address", "contact"]
  },
  DUPLICATE: {
    label: "Duplicate Records",
    icon: User,
    color: "bg-gold-100 text-gold-800 border-gold-300",
    keywords: ["duplicate", "already exists", "unique"]
  }
};

function categorizeError(errorMessage) {
  const lowerError = errorMessage.toLowerCase();
  
  for (const [key, category] of Object.entries(ERROR_CATEGORIES)) {
    if (category.keywords.some(keyword => lowerError.includes(keyword))) {
      return key;
    }
  }
  
  return "OTHER";
}

export default function ErrorCategoryAnalyzer({ validationErrors, onSelectErrors }) {
  const [expandedCategories, setExpandedCategories] = React.useState({});

  // Categorize all errors
  const categorizedErrors = React.useMemo(() => {
    const categories = {};
    
    validationErrors.forEach((error, idx) => {
      (error.errors || []).forEach(errorMsg => {
        const category = categorizeError(errorMsg);
        
        if (!categories[category]) {
          categories[category] = [];
        }
        
        categories[category].push({
          rowIndex: idx,
          row: error.row,
          patient: error.patient,
          error: errorMsg,
          fullError: error
        });
      });
    });
    
    return categories;
  }, [validationErrors]);

  const toggleCategory = (category) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const handleSelectCategory = (category) => {
    const errorIndices = categorizedErrors[category].map(e => e.rowIndex);
    const uniqueIndices = [...new Set(errorIndices)];
    onSelectErrors(uniqueIndices);
  };

  const sortedCategories = Object.entries(categorizedErrors).sort((a, b) => b[1].length - a[1].length);

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Info className="w-5 h-5 text-navy-600" />
          Error Analysis by Category
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sortedCategories.map(([categoryKey, errors]) => {
            const category = ERROR_CATEGORIES[categoryKey] || {
              label: "Other Errors",
              icon: AlertCircle,
              color: "bg-slate-100 text-slate-800 border-slate-300"
            };
            const Icon = category.icon;
            const isExpanded = expandedCategories[categoryKey];
            const affectedRows = new Set(errors.map(e => e.row)).size;

            return (
              <Card key={categoryKey} className={`border-2 ${category.color}`}>
                <CardContent className="p-4">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => toggleCategory(categoryKey)}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${category.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{category.label}</p>
                        <p className="text-sm text-slate-600">
                          {errors.length} error{errors.length !== 1 ? 's' : ''} • {affectedRows} row{affectedRows !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectCategory(categoryKey);
                        }}
                        className="text-xs"
                      >
                        Select All
                      </Button>
                      {isExpanded ? (
                        <ChevronUp className="w-5 h-5 text-slate-500" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-slate-500" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t">
                      <ScrollArea className="h-48">
                        <div className="space-y-2">
                          {errors.slice(0, 10).map((error, idx) => (
                            <Alert key={idx} variant="destructive" className="bg-white">
                              <AlertDescription className="text-sm">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1">
                                    <span className="font-semibold">Row {error.row}:</span> {error.patient}
                                    <p className="text-xs mt-1 text-slate-700">{error.error}</p>
                                  </div>
                                </div>
                              </AlertDescription>
                            </Alert>
                          ))}
                          {errors.length > 10 && (
                            <p className="text-xs text-slate-500 text-center py-2">
                              + {errors.length - 10} more errors
                            </p>
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {sortedCategories.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <Info className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p>No errors to analyze</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}