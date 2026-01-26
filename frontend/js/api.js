// js/api.js

// Importa configuração centralizada (gerada automaticamente)
import { API_BASE_URL } from './config.js';

// Mantém compatibilidade com código existente
export const API_BASE = API_BASE_URL; 

export async function apiFetch(endpoint, options = {}) {
    // ... (o resto do seu código continua igual)
    const token = localStorage.getItem('token');
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // ... logs ...

    try {
        // Usa a configuração centralizada
        const res = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
        
        // ... tratamentos de erro ...

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Erro na requisição');
        }

        return await res.json();
    } catch (error) {
        console.error("💥 API Error:", error);
        return null;
    }
}