import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#16181D",
        "ink-soft": "#1E212A",
        "ink-line": "#2C303B",
        paper: "#EDE4D0",
        "paper-dim": "#DCD0B4",
        brass: "#C89B3C",
        "brass-bright": "#E0B75C",
        stamp: "#2F6F6B",
        "stamp-bright": "#4C9490",
        rust: "#B3543F",
        fog: "#9AA1AE",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
      },
      backgroundImage: {
        "grain": "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.035) 1px, transparent 0)",
      },
      backgroundSize: {
        grain: "3px 3px",
      },
      boxShadow: {
        ticket: "0 12px 30px -10px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};
export default config;
