/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // LCARS palette anchors — refined later in the visual pass.
        "lcars-orange": "#ff9966",
        "lcars-violet": "#cc99cc",
        "lcars-blue": "#9999ff",
        "lcars-amber": "#ffcc66",
        "lcars-bg": "#000000",
      },
      fontFamily: {
        lcars: ['"Antonio"', '"Inter"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
