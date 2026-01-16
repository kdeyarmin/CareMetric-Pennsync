import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, Pencil, Type, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function ProviderPracticeInfoManager({ userEmail, credentialType = 'NP' }) {
  const queryClient = useQueryClient();
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [formData, setFormData] = useState({
    practice_name: "",
    provider_name: "",
    license_number: "",
    license_state: "",
    npi_number: "",
    specialty: credentialType === 'PHYSICIAN' ? "" : undefined,
    practice_address: "",
    practice_phone: "",
    practice_fax: "",
    practice_email: "",
    signature_type: "typed",
    signature_data: "",
    include_header: true,
    include_signature: true
  });

  // Determine which fields to show based on provider type
  const isPhysician = credentialType === 'PHYSICIAN';
  const isTherapist = credentialType === 'Therapist';

  const { data: practiceInfo, isLoading } = useQuery({
    queryKey: ['providerPracticeInfo', userEmail],
    queryFn: async () => {
      const results = await base44.entities.ProviderPracticeInfo.filter({
        provider_email: userEmail
      });
      if (results[0]) {
        setFormData(results[0]);
      }
      return results[0] || null;
    },
    enabled: !!userEmail
  });

  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const result = practiceInfo?.id ?
        await base44.entities.ProviderPracticeInfo.update(practiceInfo.id, data) :
        await base44.entities.ProviderPracticeInfo.create({
          provider_email: userEmail,
          credential_type: credentialType,
          ...data
        });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerPracticeInfo'] });
      toast.success('Practice information saved');
    }
  });

  // Canvas drawing functions
  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if (e.touches) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCoordinates(e);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    if (canvasRef.current) {
      const signatureData = canvasRef.current.toDataURL();
      setFormData({ ...formData, signature_data: signatureData, signature_type: 'drawn' });
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setFormData({ ...formData, signature_data: '' });
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData({ ...formData, signature_data: file_url, signature_type: 'uploaded' });
      toast.success('Signature uploaded');
    } catch (error) {
      toast.error('Failed to upload signature');
    }
  };

  const handleSave = () => {
    if (!formData.provider_name) {
      toast.error('Provider name is required');
      return;
    }
    saveMutation.mutate(formData);
  };

  if (isLoading) {
    return <div className="text-sm text-gray-600">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Practice Information
          </CardTitle>
          <p className="text-sm text-gray-600">
            Professional details for legally compliant clinical notes
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Provider Name (with credentials) *</Label>
              <Input
                placeholder={isPhysician ? "Dr. John Smith, MD" : "John Smith, PT"}
                value={formData.provider_name}
                onChange={(e) => setFormData({ ...formData, provider_name: e.target.value })}
              />
            </div>
            <div>
              <Label>Practice Name</Label>
              <Input
                placeholder={isPhysician ? "Smith Medical Clinic" : "Smith Therapy Center"}
                value={formData.practice_name}
                onChange={(e) => setFormData({ ...formData, practice_name: e.target.value })}
              />
            </div>
            <div>
              <Label>License Number</Label>
              <Input
                placeholder="12345678"
                value={formData.license_number}
                onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
              />
            </div>
            <div>
              <Label>License State</Label>
              <Input
                placeholder="CA"
                value={formData.license_state}
                onChange={(e) => setFormData({ ...formData, license_state: e.target.value })}
              />
            </div>
            {isPhysician && (
            <div>
              <Label>NPI Number</Label>
              <Input
                placeholder="1234567890"
                value={formData.npi_number}
                onChange={(e) => setFormData({ ...formData, npi_number: e.target.value })}
              />
            </div>
            )}
            {isPhysician && (
            <div>
              <Label>Specialty</Label>
              <Input
                placeholder="Internal Medicine"
                value={formData.specialty || ''}
                onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
              />
            </div>
            )}
          </div>

          <div>
            <Label>Practice Address</Label>
            <Textarea
              placeholder="123 Main St, Suite 100, City, State 12345"
              value={formData.practice_address}
              onChange={(e) => setFormData({ ...formData, practice_address: e.target.value })}
              className="h-20"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Practice Phone</Label>
              <Input
                placeholder="(555) 123-4567"
                value={formData.practice_phone}
                onChange={(e) => setFormData({ ...formData, practice_phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Practice Fax</Label>
              <Input
                placeholder="(555) 123-4568"
                value={formData.practice_fax}
                onChange={(e) => setFormData({ ...formData, practice_fax: e.target.value })}
              />
            </div>
            <div>
              <Label>Practice Email</Label>
              <Input
                type="email"
                placeholder="contact@practice.com"
                value={formData.practice_email}
                onChange={(e) => setFormData({ ...formData, practice_email: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.include_header}
                onCheckedChange={(checked) => setFormData({ ...formData, include_header: checked })}
              />
              <Label>Include header on notes</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.include_signature}
                onCheckedChange={(checked) => setFormData({ ...formData, include_signature: checked })}
              />
              <Label>Include signature on notes</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-purple-600" />
            Electronic Signature
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={formData.signature_type || "typed"} onValueChange={(val) => setFormData({ ...formData, signature_type: val })}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="typed">
                <Type className="w-4 h-4 mr-2" />
                Type
              </TabsTrigger>
              <TabsTrigger value="drawn">
                <Pencil className="w-4 h-4 mr-2" />
                Draw
              </TabsTrigger>
              <TabsTrigger value="uploaded">
                <Upload className="w-4 h-4 mr-2" />
                Upload
              </TabsTrigger>
            </TabsList>

            <TabsContent value="typed" className="space-y-4">
              <Label>Type Your Signature</Label>
              <Input
                placeholder="Dr. John Smith"
                value={formData.signature_type === 'typed' ? formData.signature_data : ''}
                onChange={(e) => setFormData({ ...formData, signature_data: e.target.value, signature_type: 'typed' })}
                className="font-serif text-2xl italic"
              />
              {formData.signature_type === 'typed' && formData.signature_data && (
                <div className="p-4 border rounded bg-gray-50">
                  <p className="font-serif text-3xl italic text-gray-700">{formData.signature_data}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="drawn" className="space-y-4">
              <Label>Draw Your Signature</Label>
              <div className="border-2 border-dashed rounded-lg p-2 bg-white">
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={150}
                  className="w-full cursor-crosshair touch-none"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                />
              </div>
              <Button variant="outline" onClick={clearCanvas} size="sm">
                Clear Signature
              </Button>
            </TabsContent>

            <TabsContent value="uploaded" className="space-y-4">
              <Label>Upload Signature Image</Label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="signature-upload"
              />
              <label htmlFor="signature-upload">
                <Button asChild variant="outline" className="w-full cursor-pointer">
                  <div>
                    <Upload className="w-4 h-4 mr-2" />
                    Choose Image
                  </div>
                </Button>
              </label>
              {formData.signature_type === 'uploaded' && formData.signature_data && (
                <div className="p-4 border rounded bg-gray-50">
                  <img src={formData.signature_data} alt="Signature" className="max-h-32" />
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saveMutation.isPending} className="w-full">
        {saveMutation.isPending ? (
          'Saving...'
        ) : (
          <>
            <Save className="w-4 h-4 mr-2" />
            Save Practice Information
          </>
        )}
      </Button>

      {practiceInfo && (
        <Badge variant="outline" className="bg-green-50 text-green-700">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Practice information configured
        </Badge>
      )}
    </div>
  );
}