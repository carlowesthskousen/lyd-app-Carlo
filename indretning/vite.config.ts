import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative stier, så det byggede spil kan ligge i en vilkårlig undermappe.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
  },
});
