import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RotateCcw, Check } from "lucide-react";
import { toast } from "sonner";

export default function SignatureCanvas({ onSave, onCancel, signerName, isInitials = false }) {
  // Separate refs for the two tab panels. The Draw and Type panels each render
  // their own <canvas>; sharing one ref is fragile (and breaks outright if the
  // tabs are ever force-mounted), so keep them distinct.
  const drawCanvasRef = useRef(null);
  const typeCanvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [typedSignature, setTypedSignature] = useState("");
  const [selectedFont, setSelectedFont] = useState("cursive");
  const [signatureMethod, setSignatureMethod] = useState("draw");

  const startDrawing = (e) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");

    // Configure the stroke here rather than in a one-time mount effect: Radix
    // unmounts the inactive tab, so the draw canvas can remount fresh (resetting
    // its context to defaults) when the user toggles Type -> Draw.
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const x = e.clientX ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = e.clientY ? e.clientY - rect.top : e.touches[0].clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;

    e.preventDefault();
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");

    const x = e.clientX ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = e.clientY ? e.clientY - rect.top : e.touches[0].clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const generateTypedSignature = useCallback(() => {
    const canvas = typeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const text = isInitials ? typedSignature.substring(0, 3) : typedSignature;
    const fontSize = isInitials ? 60 : 40;

    ctx.font = `${fontSize}px ${selectedFont}`;
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }, [isInitials, typedSignature, selectedFont]);

  const handleSave = () => {
    // Map to a DocumentSignature.signature_method enum value (digital_signature /
    // signature_image / initials). Both the draw and type tabs produce a PNG image;
    // the raw tab ids 'draw'/'type' are not in the enum and were silently dropped.
    const resolvedSignatureMethod = isInitials ? "initials" : "signature_image";
    if (signatureMethod === "type") {
      if (!typedSignature) {
        toast.error("Please enter your signature");
        return;
      }
      generateTypedSignature();
      // Defer the read so the just-drawn text is rasterized before toDataURL.
      setTimeout(() => {
        const canvas = typeCanvasRef.current;
        if (!canvas) return;
        onSave(canvas.toDataURL("image/png"), resolvedSignatureMethod);
      }, 100);
      return;
    }

    const canvas = drawCanvasRef.current;
    if (!canvas) return;

    // Check if canvas is empty
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const isEmpty = !imageData.data.some(channel => channel !== 0);

    if (isEmpty) {
      toast.error("Please draw your signature before saving");
      return;
    }

    onSave(canvas.toDataURL("image/png"), resolvedSignatureMethod);
  };

  useEffect(() => {
    if (signatureMethod === "type" && typedSignature) {
      generateTypedSignature();
    }
  }, [typedSignature, selectedFont, signatureMethod, generateTypedSignature]);

  const fonts = [
    { value: "cursive", label: "Cursive", style: "font-['Brush_Script_MT',_cursive]" },
    { value: "serif", label: "Formal", style: "font-serif" },
    { value: "sans-serif", label: "Modern", style: "font-sans" }
  ];

  return (
    <div className="space-y-4">
      <Tabs value={signatureMethod} onValueChange={setSignatureMethod}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="draw">Draw</TabsTrigger>
          <TabsTrigger value="type">Type</TabsTrigger>
        </TabsList>

        <TabsContent value="draw" className="space-y-4">
          <Card className="p-4">
            <canvas
              ref={drawCanvasRef}
              width={500}
              height={200}
              className="border-2 border-slate-300 rounded-lg w-full cursor-crosshair touch-none"
              style={{ maxWidth: '100%', height: 'auto', aspectRatio: '500/200' }}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
            <p className="text-xs text-slate-500 mt-2 text-center">
              {isInitials ? "Draw your initials" : "Sign your name"} in the box above
            </p>
          </Card>

          <Button
            variant="outline"
            onClick={clearCanvas}
            className="w-full"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Clear
          </Button>
        </TabsContent>

        <TabsContent value="type" className="space-y-4">
          <div>
            <Label>
              {isInitials ? "Enter your initials" : "Type your full name"}
            </Label>
            <Input
              value={typedSignature}
              onChange={(e) => setTypedSignature(e.target.value)}
              placeholder={isInitials ? "e.g., JD" : signerName || "Enter your name"}
              maxLength={isInitials ? 3 : 50}
              className="mt-1"
            />
          </div>

          <div>
            <Label>Font Style</Label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {fonts.map((font) => (
                <Button
                  key={font.value}
                  type="button"
                  variant={selectedFont === font.value ? "default" : "outline"}
                  onClick={() => setSelectedFont(font.value)}
                  className={`${font.style} text-lg h-12`}
                >
                  {typedSignature || "Abc"}
                </Button>
              ))}
            </div>
          </div>

          <Card className="p-4">
            <canvas
              ref={typeCanvasRef}
              width={500}
              height={200}
              className="border-2 border-slate-300 rounded-lg w-full"
              style={{ maxWidth: '100%', height: 'auto', aspectRatio: '500/200' }}
            />
            <p className="text-xs text-slate-500 mt-2 text-center">Preview</p>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700">
          <Check className="w-4 h-4 mr-2" />
          Save Signature
        </Button>
      </div>
    </div>
  );
}
