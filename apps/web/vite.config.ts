import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/config": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
      "/v1": "http://127.0.0.1:8787"
    }
  }
});
