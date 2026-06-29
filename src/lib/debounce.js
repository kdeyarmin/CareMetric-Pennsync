/**
 * Trailing-edge debounce — drop-in replacement for the single-arg
 * `lodash/debounce(fn, wait)` usage in this codebase, without pulling in lodash.
 *
 * The returned function delays invoking `fn` until `wait` ms have elapsed since
 * the last call. It also exposes `.cancel()` to clear a pending invocation
 * (useful in effect cleanups), matching the subset of lodash's API we rely on.
 *
 * @param {(...args: any[]) => any} fn
 * @param {number} [wait=0]
 * @returns {((...args: any[]) => void) & { cancel: () => void }}
 */
export function debounce(fn, wait = 0) {
  let timer = null;

  function debounced(...args) {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  }

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}

export default debounce;
