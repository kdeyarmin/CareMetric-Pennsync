import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Palette, Type, Layout, FileText } from "lucide-react";

const colorSchemes = {
  penn_health: {
    name: "Penn Home Health (Default)",
    primary: "#2962FF",
    accent: "#009688",
    text: "#212121",
    background: "#E8EFFF"
  },
  professional_blue: {
    name: "Professional Blue",
    primary: "#1565C0",
    accent: "#0277BD",
    text: "#263238",
    background: "#E3F2FD"
  },
  warm_care: {
    name: "Warm & Caring",
    primary: "#D84315",
    accent: "#F57C00",
    text: "#3E2723",
    background: "#FFF3E0"
  },
  serene_green: {
    name: "Serene Green",
    primary: "#2E7D32",
    accent: "#388E3C",
    text: "#1B5E20",
    background: "#E8F5E9"
  },
  elegant_purple: {
    name: "Elegant Purple",
    primary: "#6A1B9A",
    accent: "#7B1FA2",
    text: "#4A148C",
    background: "#F3E5F5"
  }
};

const fonts = {
  helvetica: "Helvetica (Standard)",
  times: "Times New Roman (Traditional)",
  courier: "Courier (Typewriter)"
};

const layouts = {
  standard: {
    name: "Standard (Professional)",
    description: "Clean layout with sections and headers"
  },
  compact: {
    name: "Compact (Save Paper)",
    description: "Smaller margins, tighter spacing"
  },
  large_print: {
    name: "Large Print (Easy Reading)",
    description: "Larger fonts for better visibility"
  },
  two_column: {
    name: "Two Column (Modern)",
    description: "Magazine-style two-column layout"
  }
};

export default function HandoutStyleCustomizer({ styleOptions, onStyleChange }) {
  const handleChange = (key, value) => {
    onStyleChange({ ...styleOptions, [key]: value });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Palette className="w-4 h-4" />
          Style & Branding
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Color Scheme */}
        <div>
          <Label className="flex items-center gap-2 mb-2">
            <Palette className="w-4 h-4" />
            Color Scheme
          </Label>
          <Select 
            value={styleOptions.colorScheme || 'penn_health'} 
            onValueChange={(value) => handleChange('colorScheme', value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(colorSchemes).map(([key, scheme]) => (
                <SelectItem key={key} value={key}>
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-4 h-4 rounded" 
                      style={{ backgroundColor: scheme.primary }}
                    />
                    {scheme.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Font Family */}
        <div>
          <Label className="flex items-center gap-2 mb-2">
            <Type className="w-4 h-4" />
            Font Style
          </Label>
          <Select 
            value={styleOptions.fontFamily || 'helvetica'} 
            onValueChange={(value) => handleChange('fontFamily', value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(fonts).map(([key, name]) => (
                <SelectItem key={key} value={key}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Layout Style */}
        <div>
          <Label className="flex items-center gap-2 mb-2">
            <Layout className="w-4 h-4" />
            Layout Style
          </Label>
          <Select 
            value={styleOptions.layout || 'standard'} 
            onValueChange={(value) => handleChange('layout', value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(layouts).map(([key, layout]) => (
                <SelectItem key={key} value={key}>
                  <div className="flex flex-col">
                    <span className="font-medium">{layout.name}</span>
                    <span className="text-xs text-slate-500">{layout.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Custom Header */}
        <div>
          <Label className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" />
            Custom Header Text (Optional)
          </Label>
          <Input
            placeholder="e.g., 'Confidential Patient Information'"
            value={styleOptions.customHeader || ''}
            onChange={(e) => handleChange('customHeader', e.target.value)}
          />
        </div>

        {/* Custom Footer */}
        <div>
          <Label className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4" />
            Custom Footer Text (Optional)
          </Label>
          <Textarea
            placeholder="e.g., additional contact info or disclaimer"
            value={styleOptions.customFooter || ''}
            onChange={(e) => handleChange('customFooter', e.target.value)}
            className="min-h-[60px]"
          />
        </div>

        {/* Agency Name Override */}
        <div>
          <Label className="mb-2">
            Agency Name (Optional Override)
          </Label>
          <Input
            placeholder="Penn Home Health Inc."
            value={styleOptions.agencyName || ''}
            onChange={(e) => handleChange('agencyName', e.target.value)}
          />
        </div>

        {/* Phone Number Override */}
        <div>
          <Label className="mb-2">
            Contact Phone (Optional Override)
          </Label>
          <Input
            placeholder="724-465-0440"
            value={styleOptions.agencyPhone || ''}
            onChange={(e) => handleChange('agencyPhone', e.target.value)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export { colorSchemes, fonts, layouts };