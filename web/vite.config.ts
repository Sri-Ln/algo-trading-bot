import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Relative asset paths, so the site works under any GitHub Pages project path.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
