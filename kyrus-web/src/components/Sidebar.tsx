import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, BarChart2, PlusCircle, Users, 
  Landmark, CreditCard, Settings, Link as LinkIcon, LogOut,
  Briefcase, Layers, Building2, Upload
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

// --- TIPAGEM ---
interface EmpresaInfo {
  nome_fantasia: string;
  logo_url?: string;
  cor_primaria?: string;
}

interface UserInfo {
  is_consultor: boolean;
  empresa_id: number;
}

export function Sidebar() {
  const logout = useAuthStore((state) => state.logout);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [isConsultor, setIsConsultor] = useState(false);

  // --- CARREGAMENTO DE DADOS ---
  useEffect(() => {
    async function loadData() {
      try {
        const { data: user } = await api.get<UserInfo>('/usuarios/me');
        setIsConsultor(user.is_consultor);

        if (user.empresa_id) {
          const { data: emp } = await api.get(`/empresas/${user.empresa_id}`);
          setEmpresa(emp);
          
          // Aplica a cor da empresa em todo o sistema
          if(emp.cor_primaria) {
             document.documentElement.style.setProperty('--color-primary', emp.cor_primaria);
          }
        }
      } catch (error) {
        console.error("Erro ao carregar sidebar", error);
      }
    }
    loadData();
  }, []);

  // --- ESTRUTURA DO MENU ---
  const menuItems = [
    { icon: Home, label: 'Visão Geral', path: '/home' },
    { icon: BarChart2, label: 'Dashboard', path: '/dashboard' },
    
    // --- CORE (O Principal) ---
    { icon: PlusCircle, label: 'Lançamentos', path: '/lancamentos' },
    
    // --- CADASTROS ---
    { icon: Users, label: 'Interessados', path: '/entidades' },
    { icon: Landmark, label: 'Contas Bancárias', path: '/contas' },
    { icon: CreditCard, label: 'Cartões', path: '/cartoes' },
    { icon: Layers, label: 'Centros de Custo', path: '/centro-custo' },
    
    // --- IMPORTAÇÃO ---
    { icon: Upload, label: 'Importação', path: '/importacao' },
    
    // --- SISTEMA ---
    { icon: LinkIcon, label: 'Integrações', path: '/integracoes' },
    { icon: Settings, label: 'Configurações', path: '/config' },
  ];

  // Adiciona menu de Consultor se for o caso
  if (isConsultor) {
    menuItems.unshift({ icon: Briefcase, label: 'Área do Consultor', path: '/consultor' });
  }

  // Cor padrão se a empresa não tiver uma definida
  const primaryColor = empresa?.cor_primaria || '#2563eb'; 

  // Helper para montar a URL da imagem
  const getLogoUrl = (url?: string) => {
    if (!url) return undefined;
    if (url.startsWith('/static')) {
        const baseURL = api.defaults.baseURL?.replace('/api/v1', '') || '';
        return `${baseURL}${url}`;
    }
    return url;
  };

  const logoSrc = getLogoUrl(empresa?.logo_url);

  return (
    <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 hidden md:flex flex-col h-screen sticky top-0 transition-all z-30 shadow-sm">
      
      {/* --- HEADER DA EMPRESA --- */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex flex-col items-center justify-center min-h-40 text-center gap-3">
        
        {/* LOGO EM BOLINHA (CROPADA PERFEITA) */}
        <div className="w-20 h-20 rounded-full bg-white dark:bg-slate-700 flex items-center justify-center overflow-hidden border-4 border-slate-100 dark:border-slate-600 shadow-md shrink-0">
            {logoSrc ? (
              <img 
                src={logoSrc} 
                alt={empresa?.nome_fantasia} 
                className="w-full h-full object-cover" // <--- SEGredo: Preenche todo o círculo
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              // Fallback: Iniciais do nome
              <span className="text-2xl font-bold text-slate-400 dark:text-slate-300 w-full h-full flex items-center justify-center bg-slate-50 dark:bg-slate-800">
                {empresa?.nome_fantasia ? empresa.nome_fantasia.substring(0,2).toUpperCase() : 'KY'}
              </span>
            )}
        </div>

        {/* NOME DA EMPRESA */}
        <div className="w-full px-2">
            {empresa?.nome_fantasia ? (
                <>
                    <h1 className="text-lg font-bold text-slate-800 dark:text-white leading-tight truncate">
                        {empresa.nome_fantasia}
                    </h1>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 block">
                        Gestão Financeira
                    </span>
                </>
            ) : (
                <h1 className="text-xl font-extrabold text-slate-800 dark:text-white tracking-tighter">
                  Kyrus<span style={{ color: primaryColor }}>Tech</span>
                </h1>
            )}
        </div>

      </div>

      {/* --- NAVEGAÇÃO --- */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar mt-2">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => isActive ? { 
              backgroundColor: `${primaryColor}15`, // Fundo translúcido da cor primária
              color: primaryColor,
              borderRight: `3px solid ${primaryColor}` 
            } : { borderRight: '3px solid transparent' }}
            className={({ isActive }) => `
              flex items-center gap-3 px-4 py-3 rounded-l-xl transition-all font-medium text-sm group
              ${!isActive 
                ? 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-900 dark:hover:text-white hover:pl-5' 
                : 'shadow-sm'}
            `}
          >
            <item.icon 
                size={18} 
                strokeWidth={2.5} 
                className={`transition-transform group-hover:scale-110`}
            />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* --- FOOTER / SAIR --- */}
      <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
        <button 
            onClick={logout} 
            className="flex items-center gap-3 px-4 py-3 w-full text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors font-bold text-sm"
        >
          <LogOut size={18} strokeWidth={2.5} /> 
          Sair do Sistema
        </button>
      </div>
    </aside>
  );
}