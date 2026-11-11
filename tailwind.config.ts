import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        terminal: {
          bg: "#0b0e11",
          panel: "#12161c",
          header: "#161b22",
          border: "#2a313c",
          muted: "#8b9bb4",
          text: "#e6edf3",
        },
        up: "#f6465d",
        down: "#0ecb81",
        flat: "#8b9bb4",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Noto Sans SC"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
