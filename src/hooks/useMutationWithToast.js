import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { logger } from "@/lib/logger";

/**
 * useMutationWithToast — a thin wrapper over react-query's useMutation that
 * standardizes the three things almost every mutation in this app repeats by
 * hand: a success toast, query invalidation, and an error toast that also
 * reaches the telemetry seam (`logger.error`).
 *
 * It composes with — never replaces — caller-provided handlers: any `onSuccess`
 * / `onError` you pass still runs (after the standard toast/invalidation), so
 * adopting it is behavior-preserving.
 *
 * @param {object} opts All standard useMutation options, plus:
 *   - successMessage {string | (data, vars) => string} toast on success (omit for none)
 *   - errorMessage   {string | (err, vars) => string} toast on error
 *   - invalidateKeys {Array<string | unknown[]>} query keys invalidated on success
 */
export function useMutationWithToast({
  successMessage,
  errorMessage = "Something went wrong. Please try again.",
  invalidateKeys = [],
  onSuccess,
  onError,
  ...options
} = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    ...options,
    onSuccess: async (data, variables, context) => {
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: Array.isArray(key) ? key : [key] });
      }
      const msg = typeof successMessage === "function" ? successMessage(data, variables) : successMessage;
      if (msg) toast.success(msg);
      if (onSuccess) await onSuccess(data, variables, context);
    },
    onError: (error, variables, context) => {
      const msg = typeof errorMessage === "function" ? errorMessage(error, variables) : errorMessage;
      if (msg) toast.error(msg);
      logger.error("[mutation]", msg, error);
      if (onError) onError(error, variables, context);
    },
  });
}

export default useMutationWithToast;
