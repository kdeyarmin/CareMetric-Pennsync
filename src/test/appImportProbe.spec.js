// Temporary diagnostic: evaluates the same modules main.jsx imports at startup.
it('evaluates the startup module graph', async () => {
  await import('@/lib/alert-shim');
  const app = await import('@/App.jsx');
  expect(typeof app.default).toBe('function');
}, 120000);