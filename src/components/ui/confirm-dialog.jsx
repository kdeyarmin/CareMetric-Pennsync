import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * Promise-based confirmation dialog.
 *
 * Replaces native window.confirm() — a blocking, off-brand browser popup — with
 * an on-brand AlertDialog, while keeping call sites almost identical:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete?", description: "...", destructive: true })) {
 *     // proceed
 *   }
 *
 * Mount <ConfirmDialogProvider> inside the keyed tenant-authority boundary.
 */
const ConfirmContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [state, setState] = useState({ open: false, options: {} });
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({ open: true, options });
    });
  }, []);

  const settle = useCallback((result) => {
    setState((s) => ({ ...s, open: false }));
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  // This provider lives inside the keyed tenant-authority boundary. Resolve a
  // pending protected confirmation as denied during that boundary's commit so
  // an old async handler cannot resume with approval after revocation, logout,
  // public-route entry, or a tenant-key change.
  useLayoutEffect(() => () => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    resolve?.(false);
  }, []);

  const {
    title = "Are you sure?",
    description,
    confirmText = "Confirm",
    cancelText = "Cancel",
    destructive = false,
  } = state.options;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{cancelText}</AlertDialogCancel>
            <AlertDialogAction
              className={cn(destructive && "bg-red-600 text-white hover:bg-red-700")}
              onClick={() => settle(true)}
            >
              {confirmText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a ConfirmDialogProvider");
  }
  return ctx;
}
