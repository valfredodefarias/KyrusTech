// js/auth.js
import { apiFetch } from './api.js';

export function isAuthenticated() {
    const token = localStorage.getItem('token');
    return !!token;
}

export async function login(token) {
    localStorage.setItem('token', token);
    
    // --- NOVO: Sincronizar Cor ao Logar ---
    try {
        // 1. Descobre quem é o usuário
        const user = await apiFetch('/usuarios/me');
        if (user && user.empresa_id) {
            // 2. Busca os dados da empresa (Cor e Logo)
            const empresa = await apiFetch(`/empresas/${user.empresa_id}`);
            if (empresa && empresa.cor_primaria) {
                // 3. Salva a cor no navegador
                localStorage.setItem('kyrus_brand_color', empresa.cor_primaria);
                // 4. Aplica imediatamente
                document.documentElement.style.setProperty('--color-primary', empresa.cor_primaria);
            }
        }
    } catch (e) {
        console.error("Erro ao sincronizar tema no login:", e);
    }
    // ---------------------------------------

    window.location.href = 'home.html';
}

export function logout() {
    localStorage.removeItem('token');
    // Opcional: Limpar a cor ao sair, ou manter para a próxima vez
    // localStorage.removeItem('kyrus_brand_color'); 
    window.location.href = 'login.html';
}

export async function authGuard() {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }
    
    // --- NOVO: Verificação em segundo plano ---
    // Se o usuário der F5 e o localStorage estiver vazio (limpou cache),
    // ou se a cor mudou no banco, isso garante que atualize.
    if (!localStorage.getItem('kyrus_brand_color')) {
        try {
            const user = await apiFetch('/usuarios/me');
            if(user) {
                const empresa = await apiFetch(`/empresas/${user.empresa_id}`);
                if(empresa && empresa.cor_primaria) {
                    localStorage.setItem('kyrus_brand_color', empresa.cor_primaria);
                    document.documentElement.style.setProperty('--color-primary', empresa.cor_primaria);
                }
            }
        } catch(e) { console.error("Sync background falhou", e); }
    }
}