import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// HTTPS is required for camera access in the field. Locally, `vite` serves on
// http://localhost which browsers treat as a secure context, so the camera works
// in dev without extra setup. For LAN testing on a phone, use a tunnel or a host
// with HTTPS (see README).
export default defineConfig({
  // GitHub Pages serves from /repo-name/; set VITE_BASE in CI to match.
  // Locally (or custom domain) defaults to "/".
  base: process.env.VITE_BASE ?? "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "pwa-icon.svg"],
      manifest: {
        name: "Car Counter",
        short_name: "CarCounter",
        description:
          "Count vehicles passing a two-direction roadway using the device camera.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "any",
        icons: [
          { src: "pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          {
            src: "pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // The COCO-SSD model weights are fetched from the TFHub/CDN at runtime.
        // Cache them so the app keeps working offline after the first load.
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(storage\.googleapis\.com|tfhub\.dev|www\.kaggle\.com).*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "tfjs-model-cache",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
