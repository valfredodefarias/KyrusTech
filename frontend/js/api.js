// js/api.js

// ADICIONE 'export' AQUI 👇
export const API_BASE = 'http://192.168.0.39:8000/api/v1'; 

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
        // Usa a variável exportada
        const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
        
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