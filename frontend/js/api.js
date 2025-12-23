// js/api.js
import { API_BASE_URL } from './config.js';
import { logout } from './auth.js';

/**
 * Wrapper profissional para o fetch nativo.
 * Adiciona automaticamente o Token e trata erros globais (401).
 */
export async function apiFetch(endpoint, options = {}) {
    const token = localStorage.getItem('access_token');
    
    // Configuração padrão dos Headers
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        ...options,
        headers
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);

        // INTERCEPTADOR DE SEGURANÇA (O Guardião)
        if (response.status === 401) {
            console.warn("⛔ Sessão expirada ou token inválido.");
            logout(); // Redireciona para login
            return null;
        }

        // Se der erro 403 (Sem permissão) ou 500, podemos tratar aqui ou deixar passar
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(errorData.detail || 'Erro na requisição');
        }

        // Retorna JSON se houver conteúdo, senão null
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            return await response.json();
        }
        return null;

    } catch (error) {
        console.error("🔥 Erro de API:", error);
        throw error; // Repassa o erro para quem chamou tratar (ex: mostrar SweetAlert)
    }
}