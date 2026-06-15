/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Direction accent colors, reused across counters/overlay/charts.
        dirA: "#22d3ee", // cyan
        dirB: "#f59e0b", // amber
      },
    },
  },
  plugins: [],
};
