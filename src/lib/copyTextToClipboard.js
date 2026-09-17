import { toast } from 'sonner';

/** Confirm the guarded native write before a caller reports copy success. */
export async function copyTextToClipboard(text) {
  try {
    // Keep the document-wide authority guard installed on this method. A stale
    // realm can throw synchronously; browser permission failures can reject.
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Never log clipboard content or include a native error's details in UI.
    toast.error('Could not copy to clipboard. Please try again.');
    return false;
  }
}
