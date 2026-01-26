import { logout } from './auth.js';
import { toggleDarkMode } from './theme.js';

export async function renderSidebar(activePageId) {
    // Carrega informações do usuário para verificar se é consultor
    let isConsultor = false;
    try {
        const { apiFetch } = await import('./api.js');
        const user = await apiFetch('/usuarios/me');
        if (user && user.is_consultor) {
            isConsultor = true;
            window.currentUser = user; // Armazena para uso posterior
        }
    } catch (e) {
        console.error('Erro ao verificar permissões:', e);
    }
    
    const sidebarHTML = `
    <aside class="w-64 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col transition-all duration-300 fixed md:relative z-30 hidden md:flex">
        
        <!-- Logo da Empresa (Customizável) -->
        <div class="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold">K</div>
            <h1 class="text-xl font-extrabold text-slate-800 dark:text-white tracking-tight">
                Kyrus<span class="text-primary">ERP</span>
            </h1>
        </div>

        <!-- Menu de Navegação -->
        <nav class="flex-1 overflow-y-auto py-4 px-3 space-y-1">
            ${createMenuItem('dashboard', 'Dashboard', 'layout-dashboard', activePageId)}
            ${createMenuItem('lancamentos', 'Lançamentos', 'arrow-left-right', activePageId)}
            
            <div class="pt-4 pb-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cadastros</div>
            ${createMenuItem('entidades', 'Entidades', 'users', activePageId)}
            ${createMenuItem('contas', 'Contas Bancárias', 'wallet', activePageId)}
            ${createMenuItem('cartoes', 'Cartões', 'credit-card', activePageId)}
            ${createMenuItem('centro_custo', 'Centros de Custo', 'pie-chart', activePageId)}
            
            <div class="pt-4 pb-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Configuração</div>
            ${createMenuItem('configuracoes', 'Minha Empresa', 'settings', activePageId)}
            ${createMenuItem('integracoes_bancarias', 'Integrações Bancárias', 'link', activePageId)}
            ${isConsultor ? `
                <div class="pt-4 pb-2 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Administração</div>
                ${createMenuItem('consultor', 'Consultor Interno', 'shield-check', activePageId)}
            ` : ''}
        </nav>

        <!-- Rodapé do Menu -->
        <div class="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <div class="flex items-center justify-between mb-3">
                <button id="btnThemeToggle" class="p-2 text-slate-400 hover:text-primary transition rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
                    <i data-lucide="moon" class="w-5 h-5"></i>
                </button>
                <button id="btnLogout" class="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition">
                    <i data-lucide="log-out" class="w-5 h-5"></i>
                </button>
            </div>
            <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300">U</div>
                <div class="overflow-hidden">
                    <p class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">Usuário Admin</p>
                    <p class="text-[10px] text-slate-500 dark:text-slate-400 truncate">admin@kyrus.com</p>
                </div>
            </div>
        </div>
    </aside>
    `;

    document.getElementById('sidebar-container').innerHTML = sidebarHTML;

    // Reconecta eventos (já que inserimos HTML dinâmico)
    document.getElementById('btnLogout').addEventListener('click', logout);
    document.getElementById('btnThemeToggle').addEventListener('click', () => {
        toggleDarkMode();
        // Recarrega ícones ou altera ícone do sol/lua
    });
    
    // Renderiza ícones
    if (window.lucide) lucide.createIcons();
}

function createMenuItem(id, label, icon, activeId) {
    const isActive = id === activeId;
    // Classes dinâmicas: Se ativo, usa bg-primary (variável) e texto branco
    const classes = isActive 
        ? "bg-primary text-white shadow-md shadow-blue-500/30" 
        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800";

    return `
        <a href="${id}.html" class="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 font-medium text-sm ${classes} group">
            <i data-lucide="${icon}" class="w-5 h-5 transition-transform group-hover:scale-110"></i>
            <span>${label}</span>
        </a>
    `;
}