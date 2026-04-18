import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",
        panel: "#111A2B",
        line: "#22304A",
        mist: "#91A3BF",
        glow: "#CDAE63",
        field: "#1E8E5A",
        alert: "#B75D1C",
        danger: "#B23A48"
      },
      boxShadow: {
        panel: "0 16px 40px rgba(7, 13, 24, 0.22)"
      }
    }
  },
  plugins: []
};

export default config;
