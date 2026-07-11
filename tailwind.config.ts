import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#102033",
        surface: "#f6faff",
        brand: "#0b63f6",
        mint: "#008a78",
        amber: "#b56a00",
        navy: "#102033",
        steel: "#41546b",
        cyan: "#00a6d6",
        line: "#dce7f3",
        panel: "#ffffff",
        muted: "#66788f"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(31, 57, 87, 0.10)",
        panel: "0 1px 0 rgba(255, 255, 255, 0.92) inset, 0 16px 44px rgba(31, 57, 87, 0.09)",
        focus: "0 0 0 4px rgba(15, 98, 254, 0.16)",
        glow: "0 0 0 1px rgba(0, 166, 214, 0.18), 0 18px 48px rgba(0, 166, 214, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
