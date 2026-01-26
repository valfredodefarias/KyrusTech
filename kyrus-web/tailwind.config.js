/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Ativa o modo escuro via classe (importante para seu projeto)
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)', // Usa sua variável CSS existente
      }
    },
  },
  plugins: [],
}