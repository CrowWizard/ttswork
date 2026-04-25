import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#f2eee7",
        "canvas-warm": "#f7f2e9",
        "canvas-cool": "#e8edf3",
        surface: "#f8f4ed",
        "surface-muted": "#ede6dc",
        "surface-elevated": "#fbf8f2",
        "surface-inset": "#e5dccf",
        "surface-selected": "#fdfaf4",
        "border-subtle": "#d7cbbb",
        "border-strong": "#a99b8a",
        "text-primary": "#211f1b",
        "text-secondary": "#575047",
        "text-muted": "#5a5249",
        "text-inverse": "#fffefa",
        "action-primary": "#234a42",
        "action-primary-hover": "#19362f",
        "action-secondary": "#b86432",
        "action-secondary-hover": "#9f4e25",
        "action-record": "#f0c66b",
        "action-record-hover": "#e8b24f",
        "action-record-active": "#b63d2f",
        danger: "#a33a31",
        "danger-surface": "#fae7e2",
        "danger-border": "#e9b6ad",
        success: "#276b55",
        "success-surface": "#e4f1e9",
        "success-border": "#a8d1bc",
        warning: "#9a5c19",
        "warning-surface": "#f8ead0",
        "warning-border": "#e2bf7a",
        info: "#34516f",
        "info-surface": "#e5edf5",
        "info-border": "#b4c6da",
      },
      boxShadow: {
        card: "0 1px 2px rgba(69, 53, 35, 0.05)",
        panel: "0 1px 1px rgba(69, 53, 35, 0.04)",
        control: "inset 0 1px 0 rgba(255, 254, 250, 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
