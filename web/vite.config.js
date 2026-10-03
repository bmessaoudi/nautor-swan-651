import { resolve } from "node:path";
import { defineConfig } from "vite";

// Il museo 3D (index.html) offre anche la visita audio (audio.html).
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        museo: resolve(import.meta.dirname, "index.html"),
        audio: resolve(import.meta.dirname, "audio.html"),
      },
    },
  },
});
