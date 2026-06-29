// Reject if a promise (e.g. an LLM call) doesn't settle within `ms`, so a hung
// network request surfaces an error the UI can recover from instead of an
// indefinite spinner. The timer is always cleared so it can't leak or fire late.
//
// IMPORTANT: loaded by the node test runner, so it may only import other plain
// `.js` modules with explicit extensions (never `.jsx`).

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms timeout in milliseconds
 * @param {string} message error message on timeout
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms = 45000, message = "The request timed out. Please try again.") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
