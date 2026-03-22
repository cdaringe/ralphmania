/**
 * Minimal set-theory utilities used by the orchestrator.
 * @see https://github.com/haydn/set-fns/blob/master/index.ts
 */
const set = <T>(x: Iterable<T> = []): Set<T> =>
  x instanceof Set ? x : new Set(x);

const and = <T>(a: Iterable<T>, b: Iterable<T>): Set<T> => {
  const A = set(a);
  const B = set(b);
  return set([...A].filter((x) => B.has(x)));
};

const or = <T>(a: Iterable<T>, b: Iterable<T>): Set<T> => set([...a, ...b]);

const not = <T>(a: Iterable<T>, b: Iterable<T>): Set<T> => {
  const A = set(a);
  const B = set(b);
  return set([...A].filter((x) => !B.has(x)));
};

const xor = <T>(a: Iterable<T>, b: Iterable<T>): Set<T> =>
  not(or(a, b), and(a, b));

export { not as difference, set, xor };
