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
        cream: "#fffaf5",
        sand: "#f5eadb",
        mist: "#eef4ff",
        ink: "#1f2937",
      },
      boxShadow: {
        soft: "0 24px 60px rgba(31, 41, 55, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
