import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        'neon-green': '#39FF14',
        'neon-blue': '#00F0FF',
        'neon-purple': '#BC13FE',
        'neon-pink': '#FF10F0',
        'cyber-dark': '#0a0e27',
        'cyber-darker': '#050814',
      },
    },
  },
  plugins: [],
};
export default config;

