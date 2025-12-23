// js/theme.js

// 1. Carrega preferências salvas
export function initTheme() {
    // Dark Mode
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    // Cor Primária da Empresa (Pega do localStorage ou usa padrão)
    const storedColor = localStorage.getItem('company_color') || '#0d6efd'; // Azul padrão Kyrus
    setPrimaryColor(storedColor);
}

export function toggleDarkMode() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.theme = 'light';
    } else {
        html.classList.add('dark');
        localStorage.theme = 'dark';
    }
}

/**
 * Aplica a cor primária dinâmica usando Variáveis CSS.
 * Isso permite que o Tailwind use a cor da empresa.
 */
export function setPrimaryColor(hexColor) {
    document.documentElement.style.setProperty('--color-primary', hexColor);
    // Salva para persistir entre recargas
    localStorage.setItem('company_color', hexColor);
}