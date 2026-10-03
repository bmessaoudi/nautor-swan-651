import { resolve } from "node:path";
import { defineConfig } from "vite";

// Due pagine: l'intro (index.html) porta al museo 3D (modello.html).
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        intro: resolve(import.meta.dirname, "index.html"),
        modello: resolve(import.meta.dirname, "modello.html"),
      },
    },
  },
});
