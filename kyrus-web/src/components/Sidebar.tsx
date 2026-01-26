import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, BarChart2, PlusCircle, Users, 
  Landmark, CreditCard, Settings, Link as LinkIcon, LogOut,
  Briefcase, Layers, UploadCloud
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';

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

  useEffect(() => {
    async function loadData() {
      try {
        const { data: user } = await api.get<UserInfo>('/usuarios/me');
        setIsConsultor(user.is_consultor);

        if (user.empresa_id) {
          const { data: emp } = await api.get(`/empresas/${user.empresa_id}`);
          setEmpresa(emp);
        }
      } catch (error) {
        console.error("Erro sidebar", error);
      }
    }
    loadData();
  }, []);

  const menuItems = [
    { icon: Home, label: 'Visão Geral', path: '/home' },
    { icon: BarChart2, label: 'Dashboard', path: '/dashboard' },
    
    // --- O PROTAGONISTA DO SISTEMA ---
    { icon: PlusCircle, label: 'Lançamentos', path: '/lancamentos' },
    // --------------------------------
    
    { icon: UploadCloud, label: 'Importação', path: '/importacao' },
    { icon: Layers, label: 'Centros de Custo', path: '/centro-custo' },
    { icon: Users, label: 'Entidades', path: '/entidades' },
    { icon: Landmark, label: 'Contas', path: '/contas' },
    { icon: CreditCard, label: 'Cartões', path: '/cartoes' },
    { icon: LinkIcon, label: 'Integrações', path: '/integracoes' },
    { icon: Settings, label: 'Configurações', path: '/config' },
  ];

  if (isConsultor) {
    menuItems.unshift({ icon: Briefcase, label: 'Área do Consultor', path: '/consultor' });
  }

  const primaryColor = empresa?.cor_primaria || '#2563eb'; 

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
    <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 hidden md:flex flex-col h-screen sticky top-0 transition-all">
      
      {/* HEADER */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex items-center justify-center min-h-[88px]">
        {logoSrc ? (
          <img 
            src={logoSrc} 
            alt={empresa?.nome_fantasia} 
            className="max-h-12 max-w-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const parent = (e.target as HTMLElement).parentElement;
              if (parent) {
                 const fallbackTitle = document.createElement('h1');
                 fallbackTitle.className = "text-2xl font-extrabold text-slate-800 dark:text-white";
                 fallbackTitle.innerHTML = `Kyrus<span style="color: ${primaryColor}">ERP</span>`;
                 parent.appendChild(fallbackTitle);
              }
            }}
          />
        ) : (
          <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">
            Kyrus<span style={{ color: primaryColor }}>ERP</span>
          </h1>
        )}
      </div>

      {/* NAVEGAÇÃO */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto custom-scrollbar">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            style={({ isActive }) => isActive ? { 
              backgroundColor: `${primaryColor}15`, 
              color: primaryColor 
            } : {}}
            className={({ isActive }) => `
              flex items-center gap-3 px-4 py-3 rounded-lg transition-colors font-medium
              ${!isActive && 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}
            `}
          >
            <item.icon size={20} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* SAIR */}
      <div className="p-4 border-t border-slate-100 dark:border-slate-700">
        <button onClick={logout} className="flex items-center gap-3 px-4 py-3 w-full text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors font-medium">
          <LogOut size={20} /> Sair
        </button>
      </div>
    </aside>
  );
}