import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Type,
  Image as ImageIcon,
  Edit3,
  Trash2,
  Copy,
  Move,
  CheckSquare,
  FileSignature,
  Calendar,
  Hash,
  ToggleLeft,
  Eye,
  ArrowUp,
  ArrowDown,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";

export default function VisualPDFTemplateEditor({ 
  templateElements = [], 
  onElementsChange,
  pdfUrl
}) {
  // Track selection by id and derive the live element from templateElements, so the
  // properties panel always edits current state. Storing a full element snapshot let
  // sequential edits spread from a stale copy and clobber the previous edit.
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [draggedElement, setDraggedElement] = useState(null);
  const canvasRef = useRef(null);

  const selectedElement = templateElements.find(el => el.id === selectedElementId) || null;

  const elementTypes = [
    { type: 'text', icon: Type, label: 'Text Field', color: 'blue' },
    { type: 'signature', icon: FileSignature, label: 'Signature', color: 'purple' },
    { type: 'date', icon: Calendar, label: 'Date Field', color: 'green' },
    { type: 'number', icon: Hash, label: 'Number', color: 'orange' },
    { type: 'checkbox', icon: CheckSquare, label: 'Checkbox', color: 'indigo' },
    { type: 'image', icon: ImageIcon, label: 'Image', color: 'pink' },
    { type: 'rich_text', icon: Edit3, label: 'Rich Text', color: 'teal' }
  ];

  const handleAddElement = (type) => {
    const newElement = {
      id: Date.now().toString(),
      type,
      label: `${type.charAt(0).toUpperCase() + type.slice(1)} ${templateElements.length + 1}`,
      position: { x: 50, y: 50 + (templateElements.length * 60) },
      size: { width: 200, height: type === 'rich_text' ? 150 : 40 },
      properties: {
        required: false,
        placeholder: '',
        defaultValue: '',
        fontSize: 12,
        fontWeight: 'normal',
        alignment: 'left',
        conditional: null // {field: 'other_field_id', operator: 'equals', value: 'someValue'}
      }
    };
    onElementsChange([...templateElements, newElement]);
    toast.success(`${type} field added`);
  };

  const handleUpdateElement = (id, updates) => {
    onElementsChange(
      templateElements.map(el => el.id === id ? { ...el, ...updates } : el)
    );
  };

  const handleDeleteElement = (id) => {
    onElementsChange(templateElements.filter(el => el.id !== id));
    setSelectedElementId(null);
    toast.success('Element deleted');
  };

  const handleDuplicateElement = (element) => {
    const newElement = {
      ...element,
      id: Date.now().toString(),
      label: `${element.label} (Copy)`,
      position: { x: element.position.x + 20, y: element.position.y + 20 }
    };
    onElementsChange([...templateElements, newElement]);
    toast.success('Element duplicated');
  };

  const handleMoveElement = (id, direction) => {
    const currentIndex = templateElements.findIndex(el => el.id === id);
    if (
      (direction === 'up' && currentIndex === 0) ||
      (direction === 'down' && currentIndex === templateElements.length - 1)
    ) {
      return;
    }

    const newElements = [...templateElements];
    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    [newElements[currentIndex], newElements[swapIndex]] = 
      [newElements[swapIndex], newElements[currentIndex]];
    onElementsChange(newElements);
  };

  const handleDragStart = (e, element) => {
    setDraggedElement(element);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (!draggedElement || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    handleUpdateElement(draggedElement.id, {
      position: { x, y }
    });
    setDraggedElement(null);
  };

  const renderElementIcon = (type) => {
    const elementType = elementTypes.find(et => et.type === type);
    if (!elementType) return null;
    const Icon = elementType.icon;
    return <Icon className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="visual" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="visual">Visual Editor</TabsTrigger>
          <TabsTrigger value="properties">Element Properties</TabsTrigger>
        </TabsList>

        <TabsContent value="visual" className="space-y-4">
          {/* Toolbar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-navy-600" />
                Element Palette
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {elementTypes.map(({ type, icon: Icon, label, color }) => (
                  <Button
                    key={type}
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddElement(type)}
                    className={`bg-${color}-50 hover:bg-${color}-100 border-${color}-200`}
                  >
                    <Icon className="w-4 h-4 mr-2" />
                    {label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Canvas */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Template Canvas</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                ref={canvasRef}
                className="relative min-h-[600px] bg-white border-2 border-dashed border-slate-300 rounded-lg overflow-auto"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                style={{
                  backgroundImage: pdfUrl ? `url(${pdfUrl})` : 'none',
                  backgroundSize: 'contain',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'center'
                }}
              >
                {templateElements.map((element) => (
                  <div
                    key={element.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, element)}
                    onClick={() => setSelectedElementId(element.id)}
                    className={`absolute p-2 bg-white border-2 rounded cursor-move transition-all ${
                      selectedElement?.id === element.id
                        ? 'border-blue-500 shadow-lg'
                        : 'border-slate-300 hover:border-blue-400'
                    }`}
                    style={{
                      left: element.position.x,
                      top: element.position.y,
                      width: element.size.width,
                      minHeight: element.size.height,
                      opacity: element.properties.conditional ? 0.7 : 1
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {renderElementIcon(element.type)}
                      <span className="text-xs font-medium text-slate-700">
                        {element.label}
                      </span>
                      {element.properties.required && (
                        <span className="text-red-500 text-xs">*</span>
                      )}
                      {element.properties.conditional && (
                        <Badge variant="outline" className="text-xs">
                          <ToggleLeft className="w-3 h-3 mr-1" />
                          Conditional
                        </Badge>
                      )}
                    </div>
                    {element.type === 'text' && (
                      <Input
                        placeholder={element.properties.placeholder || 'Text input'}
                        disabled
                        className="h-6 text-xs"
                      />
                    )}
                    {element.type === 'rich_text' && (
                      <div className="text-xs text-slate-500 italic">
                        Rich text area
                      </div>
                    )}
                    {element.type === 'signature' && (
                      <div className="border-t-2 border-slate-400 text-center text-xs text-slate-500">
                        Signature Line
                      </div>
                    )}
                    {element.type === 'checkbox' && (
                      <div className="flex items-center gap-2">
                        <input type="checkbox" disabled />
                        <span className="text-xs">{element.properties.placeholder}</span>
                      </div>
                    )}
                  </div>
                ))}

                {templateElements.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-400">
                    <div className="text-center">
                      <Move className="w-12 h-12 mx-auto mb-2" />
                      <p>Drag and drop elements here or click "Add Element" buttons above</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="properties" className="space-y-4">
          {selectedElement ? (
            <ElementPropertiesPanel
              element={selectedElement}
              allElements={templateElements}
              onUpdate={(updates) => handleUpdateElement(selectedElement.id, updates)}
              onDelete={() => handleDeleteElement(selectedElement.id)}
              onDuplicate={() => handleDuplicateElement(selectedElement)}
              onMove={handleMoveElement}
            />
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-slate-500">
                <Edit3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>Select an element from the canvas to edit its properties</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Element List Sidebar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Elements ({templateElements.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {templateElements.map((element, index) => (
              <div
                key={element.id}
                className={`flex items-center gap-2 p-2 rounded cursor-pointer ${
                  selectedElement?.id === element.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-slate-50'
                }`}
                onClick={() => setSelectedElementId(element.id)}
              >
                {renderElementIcon(element.type)}
                <span className="flex-1 text-sm">{element.label}</span>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveElement(element.id, 'up');
                    }}
                    disabled={index === 0}
                  >
                    <ArrowUp className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMoveElement(element.id, 'down');
                    }}
                    disabled={index === templateElements.length - 1}
                  >
                    <ArrowDown className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicateElement(element);
                    }}
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteElement(element.id);
                    }}
                  >
                    <Trash2 className="w-3 h-3 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ElementPropertiesPanel({ element, allElements, onUpdate, onDelete, onDuplicate, _onMove }) {
  const [richTextValue, setRichTextValue] = useState(element.properties.defaultValue || '');

  const handleRichTextChange = (value) => {
    setRichTextValue(value);
    onUpdate({
      properties: { ...element.properties, defaultValue: value }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          <span>Edit: {element.label}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={onDuplicate}>
              <Copy className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="w-4 h-4 text-red-600" />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Basic Properties */}
        <div>
          <Label>Label</Label>
          <Input
            value={element.label}
            onChange={(e) => onUpdate({ label: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Width (px)</Label>
            <Input
              type="number"
              value={element.size.width}
              onChange={(e) =>
                onUpdate({ size: { ...element.size, width: parseInt(e.target.value) } })
              }
            />
          </div>
          <div>
            <Label>Height (px)</Label>
            <Input
              type="number"
              value={element.size.height}
              onChange={(e) =>
                onUpdate({ size: { ...element.size, height: parseInt(e.target.value) } })
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>X Position</Label>
            <Input
              type="number"
              value={element.position.x}
              onChange={(e) =>
                onUpdate({ position: { ...element.position, x: parseInt(e.target.value) } })
              }
            />
          </div>
          <div>
            <Label>Y Position</Label>
            <Input
              type="number"
              value={element.position.y}
              onChange={(e) =>
                onUpdate({ position: { ...element.position, y: parseInt(e.target.value) } })
              }
            />
          </div>
        </div>

        {/* Type-specific properties */}
        {(element.type === 'text' || element.type === 'number' || element.type === 'date') && (
          <>
            <div>
              <Label>Placeholder</Label>
              <Input
                value={element.properties.placeholder || ''}
                onChange={(e) =>
                  onUpdate({
                    properties: { ...element.properties, placeholder: e.target.value }
                  })
                }
              />
            </div>
            <div>
              <Label>Default Value</Label>
              <Input
                value={element.properties.defaultValue || ''}
                onChange={(e) =>
                  onUpdate({
                    properties: { ...element.properties, defaultValue: e.target.value }
                  })
                }
              />
            </div>
          </>
        )}

        {element.type === 'rich_text' && (
          <div>
            <Label>Rich Text Content / Instructions</Label>
            <ReactQuill
              theme="snow"
              value={richTextValue}
              onChange={handleRichTextChange}
              modules={{
                toolbar: [
                  [{ header: [1, 2, 3, false] }],
                  ['bold', 'italic', 'underline', 'strike'],
                  [{ list: 'ordered' }, { list: 'bullet' }],
                  [{ color: [] }, { background: [] }],
                  ['link'],
                  ['clean']
                ]
              }}
            />
          </div>
        )}

        {/* Styling */}
        <div className="border-t pt-4">
          <Label className="text-sm font-semibold mb-2 block">Styling</Label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Font Size</Label>
              <Input
                type="number"
                value={element.properties.fontSize}
                onChange={(e) =>
                  onUpdate({
                    properties: { ...element.properties, fontSize: parseInt(e.target.value) }
                  })
                }
              />
            </div>
            <div>
              <Label className="text-xs">Weight</Label>
              <Select
                value={element.properties.fontWeight}
                onValueChange={(value) =>
                  onUpdate({ properties: { ...element.properties, fontWeight: value } })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="bold">Bold</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Alignment</Label>
              <Select
                value={element.properties.alignment}
                onValueChange={(value) =>
                  onUpdate({ properties: { ...element.properties, alignment: value } })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="left">Left</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="right">Right</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Required */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="required"
            checked={element.properties.required}
            onChange={(e) =>
              onUpdate({
                properties: { ...element.properties, required: e.target.checked }
              })
            }
          />
          <Label htmlFor="required" className="cursor-pointer">
            Required field
          </Label>
        </div>

        {/* Conditional Display */}
        <div className="border-t pt-4">
          <Label className="text-sm font-semibold mb-2 flex items-center gap-2">
            <ToggleLeft className="w-4 h-4" />
            Conditional Display
          </Label>
          <p className="text-xs text-slate-600 mb-3">
            Show this field only when another field meets certain criteria
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                id="enable-conditional"
                checked={!!element.properties.conditional}
                onChange={(e) => {
                  if (e.target.checked) {
                    onUpdate({
                      properties: {
                        ...element.properties,
                        conditional: {
                          field: '',
                          operator: 'equals',
                          value: ''
                        }
                      }
                    });
                  } else {
                    onUpdate({
                      properties: { ...element.properties, conditional: null }
                    });
                  }
                }}
              />
              <Label htmlFor="enable-conditional" className="cursor-pointer">
                Enable conditional display
              </Label>
            </div>

            {element.properties.conditional && (
              <div className="space-y-2 pl-6 border-l-2 border-navy-200">
                <div>
                  <Label className="text-xs">If field</Label>
                  <Select
                    value={element.properties.conditional.field}
                    onValueChange={(value) =>
                      onUpdate({
                        properties: {
                          ...element.properties,
                          conditional: { ...element.properties.conditional, field: value }
                        }
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select field" />
                    </SelectTrigger>
                    <SelectContent>
                      {allElements
                        .filter(el => el.id !== element.id)
                        .map(el => (
                          <SelectItem key={el.id} value={el.id}>
                            {el.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Condition</Label>
                  <Select
                    value={element.properties.conditional.operator}
                    onValueChange={(value) =>
                      onUpdate({
                        properties: {
                          ...element.properties,
                          conditional: { ...element.properties.conditional, operator: value }
                        }
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equals">Equals</SelectItem>
                      <SelectItem value="not_equals">Not Equals</SelectItem>
                      <SelectItem value="contains">Contains</SelectItem>
                      <SelectItem value="is_empty">Is Empty</SelectItem>
                      <SelectItem value="is_not_empty">Is Not Empty</SelectItem>
                      <SelectItem value="checked">Is Checked</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {!['is_empty', 'is_not_empty', 'checked'].includes(element.properties.conditional.operator) && (
                  <div>
                    <Label className="text-xs">Value</Label>
                    <Input
                      value={element.properties.conditional.value}
                      onChange={(e) =>
                        onUpdate({
                          properties: {
                            ...element.properties,
                            conditional: {
                              ...element.properties.conditional,
                              value: e.target.value
                            }
                          }
                        })
                      }
                      placeholder="Compare value"
                    />
                  </div>
                )}

                <div className="bg-navy-50 p-2 rounded text-xs">
                  <Eye className="w-3 h-3 inline mr-1" />
                  This field will only appear when the condition is met
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}