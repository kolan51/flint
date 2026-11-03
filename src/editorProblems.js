let items = [];
const listeners = new Set();

export function publishEditorProblems(next) {
  items = Array.isArray(next) ? next : [];
  for (const listen of listeners) listen();
}

export function readEditorProblems() {
  return items;
}

export function subscribeEditorProblems(listen) {
  listeners.add(listen);
  return () => listeners.delete(listen);
}
