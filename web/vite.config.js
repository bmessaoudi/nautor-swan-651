import { resolve } from "node:path";
import { defineConfig } from "vite";

// Due ingressi: il museo 3D (index.html) e la visita guidata a voce (bordo/index.html)
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        audio: resolve(import.meta.dirname, "audio.html"),
        bordo: resolve(import.meta.dirname, "bordo/index.html"),
      },
    },
  },
});
