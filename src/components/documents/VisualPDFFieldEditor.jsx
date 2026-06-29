import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Move } from "lucide-react";
import { toast } from "sonner";

const FIELD_TYPES = [
  { value: "text", label: "Text Field", color: "bg-blue-100" },
  { value: "signature", label: "Signature", color: "bg-navy-100" },
  { value: "initials", label: "Initials", color: "bg-gold-100" },
  { value: "date", label: "Date", color: "bg-green-100" },
  { value: "checkbox", label: "Checkbox", color: "bg-yellow-100" },
  { value: "table", label: "Dynamic Table", color: "bg-orange-100" },
  { value: "rich_text", label: "Rich Text", color: "bg-indigo-100" }
];

const TEXT_FORMATTING_OPTIONS = [
  { value: "bold", label: "Bold" },
  { value: "italic", label: "Italic" },
  { value: "underline", label: "Underline" }
];

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px"];
const COLORS = ["#000000", "#333333", "#666666", "#1f2937", "#dc2626", "#264491"];

export default function VisualPDFFieldEditor({ pdfUrl, onFieldsPlaced }) {
  const canvasRef = useRef(null);
  const [fields, setFields] = useState([]);
  const [selectedFieldType, setSelectedFieldType] = useState("text");
  const [fieldLabel, setFieldLabel] = useState("");
  const [draggingField, setDraggingField] = useState(null);
  const [_pdfLoaded, setPdfLoaded] = useState(false);
  const [selectedField, setSelectedField] = useState(null);
  const [fontStyle, setFontStyle] = useState({ size: "14px", bold: false, italic: false, underline: false, color: "#000000" });
  const [_conditionalLogic, _setConditionalLogic] = useState({});
  const [tableRows, setTableRows] = useState(3);
  const [tableColumns, setTableColumns] = useState(3);

  const handleCanvasClick = (e) => {
    if (!pdfUrl || !fieldLabel.trim()) {
      toast.error("Please enter a field label");
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newField = {
      id: Date.now(),
      type: selectedFieldType,
      label: fieldLabel,
      x: Math.round(x),
      y: Math.round(y),
      width: selectedFieldType === "table" ? 300 : 120,
      height: selectedFieldType === "table" ? 150 : 30,
      formatting: {
        fontSize: fontStyle.size,
        bold: fontStyle.bold,
        italic: fontStyle.italic,
        underline: fontStyle.underline,
        color: fontStyle.color
      },
      conditional: null,
      tableConfig: selectedFieldType === "table" ? { rows: tableRows, columns: tableColumns } : null
    };

    setFields([...fields, newField]);
    setFieldLabel("");
    toast.success(`${selectedFieldType} field added`);
  };

  const updateField = (fieldId, updates) => {
    setFields(fields.map(f => f.id === fieldId ? { ...f, ...updates } : f));
  };

  const removeField = (fieldId) => {
    setFields(fields.filter(f => f.id !== fieldId));
  };

  const handleDragStart = (fieldId) => {
    setDraggingField(fieldId);
  };

  const handleDragEnd = () => {
    setDraggingField(null);
  };

  const handleMouseMove = (e) => {
    if (!draggingField) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    updateField(draggingField, { x: Math.round(x), y: Math.round(y) });
  };

  const getFieldTypeColor = (type) => {
    return FIELD_TYPES.find(ft => ft.value === type)?.color || "bg-slate-100";
  };

  const handleSave = () => {
    if (fields.length === 0) {
      toast.error("Add at least one field before saving");
      return;
    }
    onFieldsPlaced(fields);
    toast.success(`${fields.length} field(s) positioned and saved`);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-2">Visual Field Editor</h3>
        <p className="text-sm text-slate-600">
          Click on the PDF to place fields. Drag fields to reposition them.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Field Configuration Panel */}
        <Card className="p-4 lg:col-span-1 h-fit">
          <div className="space-y-4">
            <div>
              <label htmlFor="field-type" className="block text-sm font-medium text-slate-700 mb-1">
                Field Type
              </label>
              <Select value={selectedFieldType} onValueChange={setSelectedFieldType}>
                <SelectTrigger id="field-type" className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map(ft => (
                    <SelectItem key={ft.value} value={ft.value}>
                      {ft.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label htmlFor="field-label" className="block text-sm font-medium text-slate-700 mb-1">
                Field Label
              </label>
              <Input
                id="field-label"
                placeholder="e.g., Patient Name"
                value={fieldLabel}
                onChange={(e) => setFieldLabel(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleCanvasClick(e);
                  }
                }}
                className="text-sm"
              />
            </div>

            {selectedFieldType === "rich_text" && (
              <div className="space-y-2">
                <div>
                  <label htmlFor="font-size" className="block text-xs font-medium text-slate-700 mb-1">
                    Font Size
                  </label>
                  <Select value={fontStyle.size} onValueChange={(size) => setFontStyle({...fontStyle, size})}>
                    <SelectTrigger id="font-size" className="text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_SIZES.map(sz => <SelectItem key={sz} value={sz}>{sz}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-1">
                    Text Color
                  </span>
                  <div className="flex gap-1">
                    {COLORS.map(color => (
                      <button
                        key={color}
                        onClick={() => setFontStyle({...fontStyle, color})}
                        className="w-6 h-6 rounded border-2"
                        style={{
                          backgroundColor: color,
                          borderColor: fontStyle.color === color ? "#000" : "#ccc"
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-1">
                    Styling
                  </span>
                  <div className="flex gap-1">
                    {TEXT_FORMATTING_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setFontStyle({...fontStyle, [opt.value]: !fontStyle[opt.value]})}
                        className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
                          fontStyle[opt.value] ? "bg-slate-800 text-white border-slate-800" : "bg-slate-100 border-slate-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {selectedFieldType === "table" && (
              <div className="space-y-2">
                <div>
                  <label htmlFor="table-rows" className="block text-xs font-medium text-slate-700 mb-1">
                    Rows
                  </label>
                  <Input
                    id="table-rows"
                    type="number"
                    min="2"
                    max="20"
                    value={tableRows}
                    onChange={(e) => setTableRows(parseInt(e.target.value) || 3)}
                    className="text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="table-columns" className="block text-xs font-medium text-slate-700 mb-1">
                    Columns
                  </label>
                  <Input
                    id="table-columns"
                    type="number"
                    min="2"
                    max="10"
                    value={tableColumns}
                    onChange={(e) => setTableColumns(parseInt(e.target.value) || 3)}
                    className="text-xs"
                  />
                </div>
              </div>
            )}

            <Button
              onClick={() => {
                const event = new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                handleCanvasClick(event);
              }}
              className="w-full text-sm"
            >
              <Plus className="w-3 h-3 mr-2" />
              Add Field
            </Button>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-900">
                  Fields: {fields.length}
                </p>
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {fields.map((field) => (
                  <div
                    key={field.id}
                    onClick={() => setSelectedField(field.id)}
                    className={`p-2 rounded-lg border cursor-pointer transition-all ${getFieldTypeColor(field.type)} ${
                      selectedField === field.id ? "ring-2 ring-blue-500 border-blue-500" : "hover:border-slate-400"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-900 truncate">
                          {field.label}
                        </p>
                        <p className="text-xs text-slate-600">
                          {field.type} @ {field.x}, {field.y}
                        </p>
                        {field.conditional && (
                          <p className="text-xs text-blue-600 mt-0.5">⚡ Has condition</p>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeField(field.id);
                        }}
                        className="p-0.5 hover:bg-red-200 rounded text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedField && (
              <div className="border-t pt-2">
                <p className="text-xs font-medium text-slate-700 mb-2">Field Options</p>
                <Button
                  onClick={() => {
                    const field = fields.find(f => f.id === selectedField);
                    if (field) {
                      updateField(selectedField, {
                        conditional: field.conditional ? null : { field: "", operator: "equals", value: "" }
                      });
                    }
                  }}
                  variant="outline"
                  className="w-full text-xs"
                >
                  {fields.find(f => f.id === selectedField)?.conditional ? "Remove Condition" : "Add Condition"}
                </Button>
              </div>
            )}

            {fields.length > 0 && (
              <Button
                onClick={handleSave}
                variant="outline"
                className="w-full text-sm mt-2"
              >
                Save Field Positions
              </Button>
            )}
          </div>
        </Card>

        {/* PDF Canvas */}
        <div className="lg:col-span-3">
          {pdfUrl ? (
            <Card className="p-4 bg-slate-100 min-h-[600px] sm:min-h-[400px] flex items-center justify-center relative overflow-auto">
              <div
                ref={canvasRef}
                onClick={handleCanvasClick}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleDragEnd}
                className="relative bg-white shadow-lg cursor-crosshair w-full max-w-2xl aspect-[8.5/11]"
              >
                {/* PDF Thumbnail as Background */}
                <img
                  src={pdfUrl}
                  alt="PDF Preview"
                  className="w-full h-full object-cover opacity-50"
                  onLoad={() => setPdfLoaded(true)}
                />

                {/* Placed Fields */}
                {fields.map((field) => {
                  const fieldType = FIELD_TYPES.find(ft => ft.value === field.type);
                  const formatting = field.formatting || {};
                  const textStyle = {
                    fontSize: formatting.fontSize || "14px",
                    fontWeight: formatting.bold ? "bold" : "normal",
                    fontStyle: formatting.italic ? "italic" : "normal",
                    textDecoration: formatting.underline ? "underline" : "none",
                    color: formatting.color || "#000000"
                  };

                  return (
                    <div
                      key={field.id}
                      draggable
                      onDragStart={() => handleDragStart(field.id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => setSelectedField(field.id)}
                      className={`absolute border-2 cursor-move transition-all ${
                        draggingField === field.id
                          ? "opacity-100 border-blue-500 bg-blue-50"
                          : selectedField === field.id ? "border-blue-600" : "border-dashed border-slate-400 hover:opacity-100"
                      } ${fieldType?.color || "bg-slate-100"} ${selectedField === field.id ? "ring-2 ring-blue-400" : ""}`}
                      style={{
                        left: `${field.x}px`,
                        top: `${field.y}px`,
                        width: `${field.width}px`,
                        height: `${field.height}px`
                      }}
                    >
                      {field.type === "table" ? (
                        <div className="w-full h-full p-1 overflow-hidden">
                          <table className="w-full h-full border-collapse text-xs">
                            <tbody>
                              {Array(field.tableConfig?.rows || 3).fill(null).map((_, row) => (
                                <tr key={row}>
                                  {Array(field.tableConfig?.columns || 3).fill(null).map((_, col) => (
                                    <td key={col} className="border border-slate-400 p-0.5" />
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full p-1" style={field.type === "rich_text" ? textStyle : {}}>
                          <span className="text-xs text-slate-700 text-center truncate">
                            {field.label}
                          </span>
                        </div>
                      )}
                      <div className="absolute -top-6 left-0 bg-slate-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap pointer-events-none">
                        {field.type} {field.conditional && "⚡"}
                      </div>
                    </div>
                  );
                })}

                {fields.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <Move className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">Click to add fields</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card className="p-8 text-center min-h-96 flex items-center justify-center">
              <div>
                <p className="text-slate-600">No PDF selected</p>
                <p className="text-sm text-slate-500 mt-1">Upload a PDF template first</p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Features Info */}
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
        <p className="text-sm font-medium text-slate-900 mb-3">Advanced Features</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <p className="font-medium text-slate-900">Rich Text Formatting</p>
            <p className="text-slate-600 mt-1">Bold, italic, underline, custom colors & sizes</p>
          </div>
          <div>
            <p className="font-medium text-slate-900">Dynamic Tables</p>
            <p className="text-slate-600 mt-1">Create configurable rows and columns</p>
          </div>
          <div>
            <p className="font-medium text-slate-900">Conditional Logic</p>
            <p className="text-slate-600 mt-1">Show/hide fields based on other answers (⚡)</p>
          </div>
        </div>
      </Card>

      {/* Field Legend */}
      <Card className="p-4 bg-slate-50">
        <p className="text-sm font-medium text-slate-900 mb-2">Field Types</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {FIELD_TYPES.map(ft => (
            <div key={ft.value} className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded ${ft.color}`} />
              <span className="text-xs text-slate-700">{ft.label}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}