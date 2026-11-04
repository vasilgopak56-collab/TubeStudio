const c = (v) => `hsl(var(--${v}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: c("background"), foreground: c("foreground"),
        card: { DEFAULT: c("card"), foreground: c("foreground") },
        popover: c("popover"), border: c("border"), input: c("input"), ring: c("ring"),
        muted: { DEFAULT: c("muted"), foreground: c("muted-foreground") },
        primary: { DEFAULT: c("primary"), foreground: c("primary-foreground") },
        secondary: { DEFAULT: c("secondary"), foreground: c("secondary-foreground") },
        accent: c("accent"), success: c("success"), crown: c("crown"),
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["'Space Mono'", "ui-monospace", "monospace"] },
      boxShadow: { btn: "0 4px 0 0 hsl(var(--primary-shadow)), 0 8px 24px -8px hsl(var(--primary) / .55)" },
      transitionDuration: { DEFAULT: "150ms" },
    },
  },
  plugins: [],
};
