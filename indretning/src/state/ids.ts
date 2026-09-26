let counter = 0;

/** Korte, unikke id'er (tid + tæller + tilfældighed). */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1296;
  return (
    prefix +
    Date.now().toString(36).slice(-5) +
    counter.toString(36).padStart(2, '0') +
    Math.random().toString(36).slice(2, 6)
  );
}
