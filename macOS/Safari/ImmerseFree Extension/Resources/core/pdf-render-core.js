export function createPdfPageRenderCoordinator(renderSourcePage) {
  const tasks = new Map();

  return {
    ensure(pageNumber) {
      const existing = tasks.get(pageNumber);
      if (existing) return existing;

      const task = Promise.resolve()
        .then(() => renderSourcePage(pageNumber))
        .catch((error) => {
          tasks.delete(pageNumber);
          throw error;
        });
      tasks.set(pageNumber, task);
      return task;
    },
    clear() {
      tasks.clear();
    }
  };
}

export function hasRenderedPdfCanvas(canvas) {
  return Boolean(canvas && Number(canvas.width) > 0 && Number(canvas.height) > 0);
}
