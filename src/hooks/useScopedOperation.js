import { useEffect, useRef } from 'react';

// A continuation belongs to one mounted record context and one operation.
// Changing A -> B -> A must not make A's abandoned request current again.
export default function useScopedOperation(identity) {
  const mounted = useRef(true);
  const scope = useRef({ identity, active: null });
  if (scope.current.identity !== identity) scope.current = { identity, active: null };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      scope.current = { identity: scope.current.identity, active: null };
    };
  }, []);
  const isCurrent = operation => Boolean(operation && mounted.current
    && operation.scope === scope.current && scope.current.active === operation);
  const begin = () => {
    if (!mounted.current || scope.current.active) return null;
    const operation = { scope: scope.current };
    scope.current.active = operation;
    return operation;
  };
  const finish = operation => {
    if (isCurrent(operation)) scope.current.active = null;
  };
  return { begin, isCurrent, finish };
}