import { apiFetch } from './api.js';

export function getToken() {
    return localStorage.getItem('access_token');
}

export function isAuthenticated() {
    const token = getToken();
    // Aqui poderíamos decodificar o JWT para ver se expirou por data, 
    // mas o apiFetch já trata o 401 do backend, o que é mais seguro.
    return !!token;
}

export function login(token) {
    localStorage.setItem('access_token', token);
    window.location.href = 'dashboard.html';
}

export function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user_data');
    window.location.href = 'login.html';
}

/**
 * Função para proteger páginas. Coloque no topo de arquivos .html restritos.
 */
export function authGuard() {
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
    }
}