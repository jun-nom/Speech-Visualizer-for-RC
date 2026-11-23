export function createMiroOperationQueue() {
  const posts: (() => Promise<void>)[] = [];
  const edits: (() => Promise<void>)[] = [];
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    try {
      let operation = posts.shift() ?? edits.shift();
      while (operation) {
        await operation();
        operation = posts.shift() ?? edits.shift();
      }
    } finally {
      running = false;
    }
  }

  return function enqueue<T>(operation: () => Promise<T>, priority = true): Promise<T> {
    return new Promise((resolve, reject) => {
      (priority ? posts : edits).push(async () => {
        try { resolve(await operation()); }
        catch (error) { reject(error); }
      });
      void drain();
    });
  };
}
