import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Plus, Trash2, Send, FileText, LayoutTemplate, Bell, BookOpen } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { generateSecureToken } from '@/components/utils/security';
import { toast } from 'sonner';

export default function SignatureRequestCreator({ onCancel }) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [selectedLibraryDoc, setSelectedLibraryDoc] = useState(null);
  
  const [signers, setSigners] = useState([
    { id: '1', name: '', email: '', role: 'Signer 1', color: 'bg-blue-500' }
  ]);
  
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [reminderInterval, setReminderInterval] = useState('3');
  
  const [fields, setFields] = useState([]);
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const containerRef = useRef(null);

  const [isSending, setIsSending] = useState(false);

  const { data: libraryDocs = [] } = useQuery({
    queryKey: ['libraryDocuments'],
    queryFn: () => base44.entities.LibraryDocument.list('-created_date', 50),
    initialData: []
  });

  const { data: pdfTemplates = [] } = useQuery({
    queryKey: ['pdfTemplates'],
    queryFn: () => base44.entities.PDFTemplate.list('-created_date', 50),
    initialData: []
  });

  const allLibraryItems = [
    ...libraryDocs.map(d => ({ id: d.id, title: d.title, file_url: d.file_url, type: 'document', category: d.category })),
    ...pdfTemplates.map(t => ({ id: t.id, title: t.template_name, file_url: t.template_file_url, type: 'template', category: t.template_category }))
  ];

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setStep(2);
    }
  };

  const addSigner = () => {
    const colors = ['bg-blue-500', 'bg-green-500', 'bg-navy-500', 'bg-orange-500', 'bg-gold-500'];
    setSigners([
      ...signers, 
      { 
        id: Date.now().toString(), 
        name: '', 
        email: '', 
        role: `Signer ${signers.length + 1}`,
        color: colors[signers.length % colors.length]
      }
    ]);
  };

  const removeSigner = (id) => {
    if (signers.length <= 1) return;
    setSigners(signers.filter(s => s.id !== id));
    // Also remove fields assigned to this signer
    setFields(fields.filter(f => f.signerId !== id));
  };

  const updateSigner = (id, field, value) => {
    setSigners(signers.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const addField = (signerId) => {
    const field = {
      id: `field-${Date.now()}`,
      signerId,
      type: 'signature',
      label: 'Signature',
      position: { x: 50, y: 50 },
      size: { width: 150, height: 40 },
      required: true
    };
    setFields([...fields, field]);
    toast.success("Field added - drag to position");
  };

  const updateField = (fieldId, updates) => {
    setFields(fields.map(f => f.id === fieldId ? { ...f, ...updates } : f));
  };

  const removeField = (fieldId) => {
    setFields(fields.filter(f => f.id !== fieldId));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  };

  const handleDragStart = (e, fieldId) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("fieldId", fieldId);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const fieldId = e.dataTransfer.getData("fieldId");
    if (!fieldId || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left - 75);
    const y = Math.max(0, e.clientY - rect.top - 20);
    
    updateField(fieldId, { position: { x, y } });
  };

  const handleSend = async () => {
    // Validate
    const invalidSigners = signers.filter(s => !s.name || !s.email);
    if (invalidSigners.length > 0) {
      toast.error('Please fill in all signer names and emails');
      return;
    }
    if (fields.length === 0) {
      toast.error('Please place at least one signature field on the document');
      return;
    }
    
    setIsSending(true);
    try {
      // 1. Upload file or use library doc
      let finalFileUrl = "";
      let finalFileName = "";
      
      if (file) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        finalFileUrl = file_url;
        finalFileName = file.name;
      } else if (selectedLibraryDoc) {
        finalFileUrl = selectedLibraryDoc.file_url;
        finalFileName = selectedLibraryDoc.title;
      } else {
        throw new Error("No file selected");
      }
      
      // 2. Map signers to format expected by DocumentSignature
      const mappedSigners = signers.map((s, _idx) => ({
        id: parseInt(s.id),
        name: s.name,
        email: s.email,
        role: 'patient', // generic role
        required: true
      }));

      // 3. Create DocumentSignature record
      const docSig = await base44.entities.DocumentSignature.create({
        document_title: finalFileName,
        document_type: 'custom_request',
        document_content: 'Uploaded PDF for signing',
        document_url: finalFileUrl,
        patient_id: "none",
        status: "pending",
        signers: mappedSigners,
        created_by_email: 'system',
        sent_date: new Date().toISOString()
      });

      // 4. Create Packages and Tokens for each signer
      for (const signer of signers) {
        const pkg = await base44.entities.DocumentPackage.create({
          package_name: `Signature Request: ${finalFileName}`,
          patient_id: "none",
          document_signatures: [docSig.id],
          status: "pending",
          due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          signer_email: signer.email,
          signer_name: signer.name,
          auto_reminder_enabled: remindersEnabled,
          reminder_days_before: parseInt(reminderInterval)
        });

        // Security: signing tokens are bearer credentials for PHI document access.
        // Use a CSPRNG (~190 bits), not the predictable Math.random().
        const token = generateSecureToken(32);
        await base44.entities.DocumentPackageToken.create({
          package_id: pkg.id,
          token: token,
          signer_email: signer.email,
          signer_name: signer.name,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });

        const origin = window.location.origin;
        const signingUrl = `${origin}/signer?token=${token}`;
        
        await base44.integrations.Core.SendEmail({
          to: signer.email,
          subject: `Signature Requested: ${finalFileName}`,
          body: `Hello ${signer.name},\n\nYou have been requested to sign a document: ${finalFileName}.\n\nPlease review and sign the document by clicking the link below:\n\n${signingUrl}\n\nThank you.`
        });
      }

      toast.success('Signature requests sent successfully!');
      
      if (onCancel) {
        onCancel();
      } else {
        setStep(1);
        setFile(null);
        setSelectedLibraryDoc(null);
        setSigners([{ id: '1', name: '', email: '', role: 'Signer 1', color: 'bg-blue-500' }]);
        setFields([]);
      }
      
    } catch (err) {
      console.error(err);
      toast.error('Failed to send signature request: ' + err.message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="border-b bg-slate-50/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl font-bold flex items-center gap-2">
            <LayoutTemplate className="w-6 h-6 text-blue-600" />
            Create Signature Request
          </CardTitle>
          {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {/* Progress Steps */}
        <div className="flex items-center justify-between mb-8 relative max-w-2xl mx-auto">
           <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-slate-100 -z-10"></div>
           <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-blue-600 -z-10 transition-all" style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }}></div>
           
           <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border-4 border-white ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>1</div>
           <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border-4 border-white ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>2</div>
           <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border-4 border-white ${step >= 3 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>3</div>
        </div>

        {step === 1 && (
          <div className="max-w-3xl mx-auto">
            <div className="text-center py-12 px-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors mb-8">
              <Upload className="w-12 h-12 mx-auto text-slate-400 mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Upload Document</h3>
              <p className="text-slate-500 mb-6">Select a PDF document that requires signatures</p>
              <div className="relative inline-block">
                <Button className="bg-blue-600 hover:bg-blue-700 pointer-events-none">
                  Browse Files
                </Button>
                <input 
                  type="file" 
                  accept=".pdf" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleFileChange}
                />
              </div>
            </div>

            <div className="relative flex py-5 items-center">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink-0 mx-4 text-slate-400 text-sm font-medium">OR</span>
                <div className="flex-grow border-t border-slate-200"></div>
            </div>

            <div className="mt-8">
              <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-600" />
                Select from Document Library
              </h3>
              
              {allLibraryItems.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {allLibraryItems.map((item) => (
                    <Card 
                      key={item.id} 
                      className="cursor-pointer hover:shadow-md transition-shadow border-slate-200"
                      onClick={() => {
                        setSelectedLibraryDoc(item);
                        setPreviewUrl(item.file_url);
                        setStep(2);
                      }}
                    >
                      <CardContent className="p-4 flex items-center gap-4">
                        <div className="p-3 bg-blue-50 rounded-lg">
                          {item.type === 'template' ? <LayoutTemplate className="w-6 h-6 text-blue-600" /> : <FileText className="w-6 h-6 text-blue-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-slate-900 truncate">{item.title}</h4>
                          <p className="text-sm text-slate-500 capitalize">{item.type} • {item.category}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <p className="text-slate-500 text-center py-8">No documents or templates found in the library.</p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-blue-50 p-4 rounded-lg flex items-center gap-3">
               <FileText className="w-5 h-5 text-blue-600" />
               <div>
                <p className="text-sm font-medium text-blue-900">Selected File</p>
                <p className="text-sm text-blue-700">{file?.name || selectedLibraryDoc?.title}</p>
               </div>
               <Button variant="ghost" size="sm" className="ml-auto text-blue-600 hover:text-blue-800 hover:bg-blue-100" onClick={() => {
                setStep(1);
                setFile(null);
                setSelectedLibraryDoc(null);
                setPreviewUrl(null);
               }}>Change</Button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Recipients</h3>
                <Button variant="outline" size="sm" onClick={addSigner} className="gap-2">
                  <Plus className="w-4 h-4" /> Add Signer
                </Button>
              </div>

              {signers.map((signer, index) => (
                <Card key={signer.id} className="relative overflow-hidden">
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${signer.color}`}></div>
                  <CardContent className="p-4 pl-6 flex flex-col gap-4 relative">
                    {signers.length > 1 && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="absolute right-2 top-2 text-slate-400 hover:text-red-500"
                        onClick={() => removeSigner(signer.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                    <h4 className="font-medium text-slate-700">Signer {index + 1}</h4>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Name</Label>
                        <Input 
                          placeholder="John Doe" 
                          value={signer.name}
                          onChange={(e) => updateSigner(signer.id, 'name', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Email</Label>
                        <Input 
                          type="email" 
                          placeholder="john@example.com" 
                          value={signer.email}
                          onChange={(e) => updateSigner(signer.id, 'email', e.target.value)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <Bell className="w-5 h-5 text-slate-600" />
                  <h3 className="font-medium">Automated Reminders</h3>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">Send reminder emails to signers</span>
                  <input 
                    type="checkbox" 
                    checked={remindersEnabled}
                    onChange={(e) => setRemindersEnabled(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                </div>
                {remindersEnabled && (
                  <div className="flex items-center gap-3 text-sm pt-2">
                    <span className="text-slate-600">Remind every</span>
                    <Select value={reminderInterval} onValueChange={setReminderInterval}>
                      <SelectTrigger className="w-24 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 day</SelectItem>
                        <SelectItem value="3">3 days</SelectItem>
                        <SelectItem value="5">5 days</SelectItem>
                        <SelectItem value="7">7 days</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-slate-600">until signed</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end pt-4">
              <Button 
                onClick={() => setStep(3)} 
                className="bg-blue-600 hover:bg-blue-700"
              >
                Next: Place Fields
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-in fade-in slide-in-from-bottom-4">
            {/* Left side: Toolbox & Fields */}
            <div className="lg:col-span-1 flex flex-col h-[700px] border rounded-xl bg-white shadow-sm overflow-hidden">
              <div className="bg-slate-50 border-b p-4">
                <h3 className="font-semibold text-slate-900">Signers</h3>
                <p className="text-xs text-slate-500 mt-1">Select a signer, then add fields.</p>
              </div>
              <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                {signers.map(signer => {
                  const signerFields = fields.filter(f => f.signerId === signer.id);
                  return (
                    <div key={signer.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${signer.color}`}></div>
                          <span className="text-sm font-medium truncate w-32" title={signer.name || `Signer ${signer.id}`}>
                            {signer.name || `Signer ${signer.id}`}
                          </span>
                        </div>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => addField(signer.id)}>
                          <Plus className="w-3 h-3 mr-1" /> Field
                        </Button>
                      </div>
                      
                      {signerFields.length > 0 && (
                        <div className="pl-5 space-y-1">
                          {signerFields.map(field => (
                            <div 
                              key={field.id}
                              onClick={() => setSelectedFieldId(field.id)}
                              className={`flex justify-between items-center text-xs p-1.5 rounded cursor-pointer ${selectedFieldId === field.id ? 'bg-blue-100 text-blue-900 font-medium' : 'hover:bg-slate-100 text-slate-600'}`}
                            >
                              <span>{field.label}</span>
                              <button onClick={(e) => { e.stopPropagation(); removeField(field.id); }} className="text-slate-400 hover:text-red-500">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedFieldId && (
                <div className="p-4 border-t bg-blue-50/50">
                  <h4 className="text-xs font-semibold uppercase text-slate-500 mb-3">Edit Field</h4>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Label</Label>
                      <Input 
                        size="sm" 
                        className="h-8 text-sm"
                        value={fields.find(f => f.id === selectedFieldId)?.label || ''}
                        onChange={(e) => updateField(selectedFieldId, { label: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="p-4 border-t bg-slate-50">
                <Button variant="outline" className="w-full mb-2" onClick={() => setStep(2)}>Back</Button>
                <Button 
                  onClick={handleSend} 
                  disabled={isSending || fields.length === 0}
                  className="w-full bg-green-600 hover:bg-green-700 gap-2"
                >
                  {isSending ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send Requests
                </Button>
              </div>
            </div>

            {/* Right side: Interactive Document Canvas */}
            <div className="lg:col-span-3 h-[700px] border rounded-xl bg-slate-200 overflow-auto relative">
              <div 
                className="mx-auto my-8 relative shadow-lg bg-white bg-no-repeat bg-contain bg-center"
                style={{
                  width: '800px', 
                  height: '1131px', // ~ letter aspect ratio
                  backgroundImage: previewUrl ? `url(${previewUrl})` : 'none'
                }}
                ref={containerRef}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                {/* Fallback visual if previewUrl is just a generic blob that can't be rendered as bg */}
                {!previewUrl?.match(/\.(jpeg|jpg|gif|png)$/i) && (
                  <div className="absolute inset-0 opacity-20 pointer-events-none">
                    <iframe src={previewUrl} className="w-full h-full" scrolling="no" />
                    <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px]"></div>
                  </div>
                )}
                
                {fields.map(field => {
                  const signer = signers.find(s => s.id === field.signerId);
                  const colorClass = signer ? signer.color : 'bg-blue-500';
                  const isSelected = selectedFieldId === field.id;
                  
                  return (
                    <div
                      key={field.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, field.id)}
                      onClick={() => setSelectedFieldId(field.id)}
                      className={`absolute border-2 cursor-move flex items-center justify-center p-2 rounded shadow-sm transition-all
                        ${isSelected ? 'ring-2 ring-offset-1 ring-blue-500 z-10' : 'opacity-90 hover:opacity-100'}
                      `}
                      style={{
                        left: `${field.position.x}px`,
                        top: `${field.position.y}px`,
                        width: `${field.size.width}px`,
                        height: `${field.size.height}px`,
                        borderColor: 'currentColor'
                      }}
                    >
                      <div className={`absolute inset-0 ${colorClass} opacity-10 rounded`}></div>
                      <div className={`text-xs font-semibold ${colorClass.replace('bg-', 'text-')} flex flex-col items-center pointer-events-none`}>
                        <span className="truncate w-full text-center px-1">{field.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}