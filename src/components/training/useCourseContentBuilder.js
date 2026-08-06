import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// Shared editor engine for the course builders (lessons + quiz). Both manage an
// ordered list of child rows for a course with the same lifecycle:
//   - seed the local list from the server ONCE per course, only after the fetch
//     has actually succeeded (no initialData — see the data-loss note in the
//     builders: initialData makes react-query report isLoading:false on the first
//     render, which would seed from an empty placeholder and let Save delete
//     every existing row),
//   - edit locally (the caller owns per-item mutations via setItems),
//   - reorder (up/down + drag-and-drop),
//   - save the whole list: delete removed rows, upsert the rest with their list
//     position as order_index, then re-seed from fresh server data so new rows
//     pick up their ids.
//
// Options:
//   courseId          - the parent course id (null disables the query)
//   queryKey          - react-query key for the child rows
//   queryFn           - () => Promise<rows>
//   entity            - a base44 entity with create/update/delete
//   toItem            - (row) => editor item (must carry `id` for existing rows)
//   toPayload         - (item, index) => entity payload
//   shouldPersist     - (item) => boolean; items failing this are dropped (and, if
//                       they had an id, deleted). Defaults to keeping everything.
//   validate          - (persistItems) => errorMessage | null; blocks save on error
//   notReadyMessage   - shown if save is attempted before the editor has seeded
//   saveErrorMessage  - fallback message when a save throws
export function useCourseContentBuilder({
  courseId,
  queryKey,
  queryFn,
  entity,
  toItem,
  toPayload,
  shouldPersist = () => true,
  validate = (_items) => null,
  notReadyMessage = "Still loading. Please try again in a moment.",
  saveErrorMessage = "Failed to save. Please try again.",
}) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const seededFor = useRef(null);

  const { data: rows = [], isLoading, isSuccess } = useQuery({
    queryKey,
    queryFn,
    enabled: !!courseId,
  });

  // When the course changes, immediately drop the previous course's rows so the
  // editor never shows or edits stale items in the window before the new query
  // resolves. Only fires on an actual courseId change (not the post-save re-seed,
  // which keeps courseId fixed).
  useEffect(() => {
    if (seededFor.current !== courseId) setItems([]);
  }, [courseId]);

  // Seed once per course, after the fetch succeeds. `toItem` is intentionally not
  // a dependency — seeding is keyed on courseId, not on the callback identity.
  useEffect(() => {
    if (!courseId || seededFor.current === courseId) return;
    if (isLoading || !isSuccess) return;
    setItems(rows.map(toItem));
    seededFor.current = courseId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, isLoading, isSuccess, rows]);

  const move = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const removeItem = (localId) =>
    setItems((prev) => prev.filter((it) => it._localId !== localId));

  const saveAll = async () => {
    setSaved(false);
    // Never save before the editor has seeded — every existing row would look
    // "removed" and get deleted.
    if (seededFor.current !== courseId) {
      setError(notReadyMessage);
      return;
    }
    const persistItems = items.filter(shouldPersist);
    const validationError = validate(persistItems);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const keptIds = new Set(persistItems.filter((it) => it.id).map((it) => it.id));
      const toDelete = rows.filter((r) => !keptIds.has(r.id));
      await Promise.all(toDelete.map((r) => entity.delete(r.id)));

      await Promise.all(
        persistItems.map((item, index) => {
          const payload = toPayload(item, index);
          return item.id ? entity.update(item.id, payload) : entity.create(payload);
        })
      );

      await queryClient.invalidateQueries({ queryKey });
      // Force a re-seed from fresh server data so new rows pick up their ids.
      seededFor.current = null;
      setSaved(true);
    } catch (err) {
      console.error("Course content save error:", err);
      setError(err?.message || saveErrorMessage);
    } finally {
      setSaving(false);
    }
  };

  return { items, setItems, saving, saved, error, setError, move, onDragEnd, removeItem, saveAll };
}
