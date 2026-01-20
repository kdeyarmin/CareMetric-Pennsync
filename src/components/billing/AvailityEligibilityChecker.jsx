import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { base44 } from '@/api/base44Client';
import { 
  Search, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Loader2,
  Calendar,
  CreditCard,
  DollarSign,
  User,
  Building2
} from 'lucide-react';

export default function AvailityEligibilityChecker({ prefilledData = {} }) {
  const [formData, setFormData] = useState({
    firstName: prefilledData.firstName || '',
    lastName: prefilledData.lastName || '',
    dateOfBirth: prefilledData.dateOfBirth || '',
    memberId: prefilledData.memberId || '',
    payerId: prefilledData.payerId || '',
    providerNPI: prefilledData.providerNPI || '',
    serviceType: '30' // Health Benefit Plan Coverage
  });

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const checkEligibility = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await base44.functions.invoke('checkAvailityEligibility', formData);
      
      if (response.data.success) {
        setResult(response.data);
      } else {
        setError(response.data.error || 'Failed to check eligibility');
      }
    } catch (err) {
      console.error('Eligibility check error:', err);
      setError(err.response?.data?.error || 'An error occurred while checking eligibility');
    } finally {
      setLoading(false);
    }
  };

  const serviceTypes = [
    { value: '30', label: 'Health Benefit Plan Coverage' },
    { value: '1', label: 'Medical Care' },
    { value: '35', label: 'Dental Care' },
    { value: '47', label: 'Hospital Inpatient' },
    { value: '50', label: 'Hospital Outpatient' },
    { value: '98', label: 'Professional (Physician)' },
    { value: 'UC', label: 'Urgent Care' },
    { value: 'AL', label: 'Vision' }
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Real-Time Eligibility Verification
          </CardTitle>
          <CardDescription>
            Check patient insurance eligibility and benefits via Availity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={checkEligibility} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  placeholder="John"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input
                  id="lastName"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                  placeholder="Doe"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dateOfBirth">Date of Birth *</Label>
                <Input
                  id="dateOfBirth"
                  name="dateOfBirth"
                  type="date"
                  value={formData.dateOfBirth}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div>
                <Label htmlFor="memberId">Member ID *</Label>
                <Input
                  id="memberId"
                  name="memberId"
                  value={formData.memberId}
                  onChange={handleInputChange}
                  required
                  placeholder="ABC123456789"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="payerId">Payer ID (Optional)</Label>
                <Input
                  id="payerId"
                  name="payerId"
                  value={formData.payerId}
                  onChange={handleInputChange}
                  placeholder="00001"
                />
              </div>
              <div>
                <Label htmlFor="providerNPI">Provider NPI (Optional)</Label>
                <Input
                  id="providerNPI"
                  name="providerNPI"
                  value={formData.providerNPI}
                  onChange={handleInputChange}
                  placeholder="1234567893"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="serviceType">Service Type</Label>
              <select
                id="serviceType"
                name="serviceType"
                value={formData.serviceType}
                onChange={handleInputChange}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {serviceTypes.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Checking Eligibility...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 mr-2" />
                  Check Eligibility
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {result.coverage.isActive ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Coverage Active
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-600" />
                  No Active Coverage
                </>
              )}
            </CardTitle>
            <CardDescription>
              Verified on {new Date(result.requestDate).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Patient Information */}
            <div>
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <User className="w-4 h-4" />
                Patient Information
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Name:</span>
                  <p className="font-medium">{result.patient.name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Member ID:</span>
                  <p className="font-medium">{result.patient.memberId}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Date of Birth:</span>
                  <p className="font-medium">{result.patient.dateOfBirth}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Payer Information */}
            <div>
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <Building2 className="w-4 h-4" />
                Payer Information
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Payer Name:</span>
                  <p className="font-medium">{result.payerInfo.payerName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Payer ID:</span>
                  <p className="font-medium">{result.payerInfo.payerId}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Coverage Details */}
            <div>
              <h3 className="font-semibold flex items-center gap-2 mb-3">
                <CreditCard className="w-4 h-4" />
                Coverage Details
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Plan Name:</span>
                  <p className="font-medium">{result.coverage.planName}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Plan Type:</span>
                  <p className="font-medium">{result.coverage.planType}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Group Number:</span>
                  <p className="font-medium">{result.coverage.groupNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant={result.coverage.isActive ? 'default' : 'destructive'}>
                    {result.coverage.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {result.coverage.effectiveDate && (
                  <div>
                    <span className="text-muted-foreground">Effective Date:</span>
                    <p className="font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(result.coverage.effectiveDate).toLocaleDateString()}
                    </p>
                  </div>
                )}
                {result.coverage.terminationDate && (
                  <div>
                    <span className="text-muted-foreground">Termination Date:</span>
                    <p className="font-medium flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(result.coverage.terminationDate).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Benefits */}
            {result.benefits && result.benefits.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold flex items-center gap-2 mb-3">
                    <DollarSign className="w-4 h-4" />
                    Benefits
                  </h3>
                  <div className="space-y-2">
                    {result.benefits.map((benefit, idx) => (
                      <div key={idx} className="text-sm p-3 bg-muted rounded-lg">
                        <p className="font-medium">{benefit.serviceType || benefit.name}</p>
                        {benefit.description && (
                          <p className="text-muted-foreground text-xs mt-1">{benefit.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Copays */}
            {result.copays && result.copays.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold mb-3">Copays</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {result.copays.map((copay, idx) => (
                      <div key={idx} className="text-sm p-3 bg-muted rounded-lg">
                        <p className="font-medium">{copay.serviceType}</p>
                        <p className="text-green-700 font-semibold">${copay.amount}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Deductibles */}
            {result.deductibles && result.deductibles.length > 0 && (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold mb-3">Deductibles</h3>
                  <div className="space-y-2">
                    {result.deductibles.map((deductible, idx) => (
                      <div key={idx} className="text-sm p-3 bg-muted rounded-lg">
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{deductible.type || 'Annual Deductible'}</span>
                          <Badge variant="outline">
                            ${deductible.remaining || 0} / ${deductible.amount || 0}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Out of Pocket Max */}
            {result.outOfPocketMax && (
              <>
                <Separator />
                <div>
                  <h3 className="font-semibold mb-3">Out of Pocket Maximum</h3>
                  <div className="text-sm p-3 bg-muted rounded-lg">
                    <div className="flex justify-between items-center">
                      <span>Annual Limit</span>
                      <span className="font-semibold text-lg">${result.outOfPocketMax.amount || 'N/A'}</span>
                    </div>
                    {result.outOfPocketMax.remaining && (
                      <div className="flex justify-between items-center mt-2 text-muted-foreground">
                        <span>Remaining</span>
                        <span>${result.outOfPocketMax.remaining}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}