import './style.css';
import { App } from './app';
import { UI } from './ui/UI';

async function main() {
  const app = new App(document.getElementById('viewport')!);
  new UI(app, document.getElementById('app')!);
  await app.init();
  document.getElementById('loading')?.remove();
  // Til fejlsøgning og automatiske tests.
  (window as unknown as { indretning: App }).indretning = app;
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `Noget gik galt: ${(err as Error).message}`;
});
