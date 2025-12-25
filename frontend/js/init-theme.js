// js/init-theme.js
export function initTheme() {
    // Tema Escuro
    const savedTheme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }

    // --- COR DA EMPRESA ---
    // Recupera o que o auth.js ou configuracoes.html salvou
    const savedColor = localStorage.getItem('kyrus_brand_color');
    if (savedColor) {
        document.documentElement.style.setProperty('--color-primary', savedColor);
    }
}
initTheme();