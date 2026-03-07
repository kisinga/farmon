/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        farmon: {
          primary: "#2e7d32",
          "primary-content": "#ffffff",
          secondary: "#66bb6a",
          "secondary-content": "#1b4a1e",
          accent: "#388e3c",
          "accent-content": "#ffffff",
          neutral: "#1b5e20",
          "neutral-content": "#e8f5e9",
          "base-100": "#f1f8e9",
          "base-200": "#c8e6c9",
          "base-300": "#a5d6a7",
          "base-content": "#1b4a1e",
          info: "#2e7d32",
          success: "#388e3c",
          warning: "#81c784",
          error: "#b71c1c",
        },
      },
      "business",
    ],
    darkTheme: "business",
  },
};
