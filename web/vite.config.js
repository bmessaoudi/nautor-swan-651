import { resolve } from "node:path";
import { defineConfig } from "vite";

// Due ingressi: la landing (index.html) e il museo guidato a voce (bordo/index.html)
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        bordo: resolve(import.meta.dirname, "bordo/index.html"),
      },
    },
  },
});
