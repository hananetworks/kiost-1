import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import svgr from "vite-plugin-svgr";   

export default defineConfig({
  plugins: [
    react(),
    svgr(), 
  ],
    root: "react",

    base: "./",
    server: {
        port: 4000,
        strictPort: true,
    },

    build: {
        outDir: "../dist",
        emptyOutDir: true,
    },

    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./react/src"),
        },
    },
});