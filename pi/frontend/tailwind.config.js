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
        // ── Light theme ──────────────────────────────────────────────────────
        // Clean whites with green reserved for brand/interactive only.
        // Surfaces are neutral so data and status colours read clearly.
        farmon: {
          primary:            "#2e7d32",   // brand green
          "primary-content":  "#ffffff",
          secondary:          "#388e3c",   // slightly lighter brand green
          "secondary-content":"#ffffff",
          accent:             "#00897b",   // teal — adds variety without clashing
          "accent-content":   "#ffffff",
          neutral:            "#374151",   // slate-grey — not green, true neutral
          "neutral-content":  "#f9fafb",
          "base-100":         "#ffffff",   // card / surface
          "base-200":         "#f4f8f4",   // page background — barely-there green tint
          "base-300":         "#e4ede4",   // dividers, input borders
          "base-content":     "#1a2e1c",   // near-black green for body text
          info:               "#0284c7",   // blue — distinct from brand green
          "info-content":     "#ffffff",
          success:            "#16a34a",   // clear mid-green success
          "success-content":  "#ffffff",
          warning:            "#d97706",   // amber — semantically correct
          "warning-content":  "#ffffff",
          error:              "#dc2626",
          "error-content":    "#ffffff",
        },
      },
      {
        // ── Dark theme ───────────────────────────────────────────────────────
        // Derived directly from the logo HTML colour system:
        // body #0a0f0b → surfaces #0f1210 / #141c15 → borders #1e2a20
        // Text #c8d8ca · muted #4a6a4c · greens brightened for legibility
        "farmon-dark": {
          primary:            "#4caf50",   // brighter on dark bg
          "primary-content":  "#0a0f0b",
          secondary:          "#66bb6a",
          "secondary-content":"#0a0f0b",
          accent:             "#26a69a",   // teal
          "accent-content":   "#0a0f0b",
          neutral:            "#1e2a20",   // dark green-black
          "neutral-content":  "#c8d8ca",
          "base-100":         "#0f1210",   // main bg (logo HTML body)
          "base-200":         "#141c15",   // elevated surfaces / cards
          "base-300":         "#1e2a20",   // borders, dividers
          "base-content":     "#c8d8ca",   // muted green-white text
          info:               "#38bdf8",
          "info-content":     "#0a0f0b",
          success:            "#4ade80",
          "success-content":  "#0a0f0b",
          warning:            "#fbbf24",
          "warning-content":  "#0a0f0b",
          error:              "#f87171",
          "error-content":    "#0a0f0b",
        },
      },
    ],
    darkTheme: "farmon-dark",
  },
};
