import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UserPlus } from 'lucide-react';
import PhysicianDirectory from './PhysicianDirectory';

export default function PhysicianSelector({ onSelectPhysician }) {
  const [open, setOpen] = useState(false);

  const handleSelect = (physician) => {
    if (onSelectPhysician) {
      onSelectPhysician(physician);
    }
    setOpen(false);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} size="sm">
        <UserPlus className="w-4 h-4 mr-1" />
        Select from Provider Directory
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Select Provider</DialogTitle>
          </DialogHeader>
          <PhysicianDirectory mode="selector" onSelectPhysician={handleSelect} />
        </DialogContent>
      </Dialog>
    </>
  );
}