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
        canvas: "var(--color-canvas)",
        "canvas-warm": "var(--color-canvas-warm)",
        "canvas-cool": "var(--color-canvas-cool)",
        surface: "var(--color-surface)",
        "surface-muted": "var(--color-surface-muted)",
        "surface-elevated": "var(--color-surface-elevated)",
        "surface-inset": "var(--color-surface-inset)",
        "surface-selected": "var(--color-surface-selected)",
        "border-subtle": "var(--color-border-subtle)",
        "border-strong": "var(--color-border-strong)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted": "var(--color-text-muted)",
        "text-inverse": "var(--color-text-inverse)",
        "action-primary": "var(--color-action-primary)",
        "action-primary-hover": "var(--color-action-primary-hover)",
        "action-secondary": "var(--color-action-secondary)",
        "action-secondary-hover": "var(--color-action-secondary-hover)",
        "action-record": "var(--color-action-record)",
        "action-record-hover": "var(--color-action-record-hover)",
        "action-record-active": "var(--color-action-record-active)",
        danger: "var(--color-danger)",
        "danger-surface": "var(--color-danger-surface)",
        "danger-border": "var(--color-danger-border)",
        success: "var(--color-success)",
        "success-surface": "var(--color-success-surface)",
        "success-border": "var(--color-success-border)",
        warning: "var(--color-warning)",
        "warning-surface": "var(--color-warning-surface)",
        "warning-border": "var(--color-warning-border)",
        info: "var(--color-info)",
        "info-surface": "var(--color-info-surface)",
        "info-border": "var(--color-info-border)",
      },
      boxShadow: {
        card: "0 1px 2px oklch(35% 0.035 70 / 0.05)",
        panel: "0 1px 1px oklch(35% 0.035 70 / 0.04)",
        control: "inset 0 1px 0 oklch(99% 0.004 83 / 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
