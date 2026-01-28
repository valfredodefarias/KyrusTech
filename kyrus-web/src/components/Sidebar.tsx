import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, BarChart2, PlusCircle, Users, 
  Landmark, CreditCard, Settings, Link as LinkIcon, LogOut,
  Briefcase, Layers, Upload, RefreshCw, ClipboardList, X
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import { useLookupStore } from '../store/lookupStore';

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

interface SidebarPanelProps {
  onNavigate?: () => void;
  showClose?: boolean;
}

function SidebarPanel({ onNavigate, showClose }: SidebarPanelProps) {
  const logout = useAuthStore((state) => state.logout);
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null);
  const [isConsultor, setIsConsultor] = useState(false);
  const fetchEntidades = useLookupStore((state) => state.fetchEntidades);
  const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const [syncing, setSyncing] = useState(false);

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

    // --- TAREFAS ---
    { icon: ClipboardList, label: 'Tarefas', path: '/tarefas' },
    
    // --- IMPORTAÇÃO ---
    { icon: Upload, label: 'Importação', path: '/importacao' },
    { icon: ClipboardList, label: 'Auditoria', path: '/auditoria' },
    
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

  const handleSyncCadastros = async () => {
    setSyncing(true);
    try {
      await Promise.all([fetchEntidades(true), fetchPlanoContas(true)]);
    } catch (error) {
      console.error('Erro ao sincronizar cadastros', error);
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    logout();
    onNavigate?.();
  };

  return (
    <>
      {/* --- HEADER DA EMPRESA --- */}
      <div className="p-6 border-b border-slate-100 dark:border-slate-700 flex flex-col items-center justify-center min-h-40 text-center gap-3 w-full relative">
        {showClose && (
          <button
            onClick={onNavigate}
            className="absolute right-4 top-4 p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            aria-label="Fechar menu"
          >
            <X size={18} />
          </button>
        )}
        
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
              <img
                src="/kyrus.png"
                alt="Logo Kyrus"
                className="w-full h-full object-contain p-2 bg-slate-50 dark:bg-slate-800"
              />
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
                <img
                  src="/kyrusnamegg.png"
                  alt="KyrusTech"
                  className="h-6 w-auto"
                />
            )}
        </div>

      </div>

      {/* --- NAVEGAÇÃO --- */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar mt-2">
        {menuItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
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
            onClick={() => { handleSyncCadastros(); onNavigate?.(); }}
            disabled={syncing}
            className="flex items-center gap-3 px-4 py-3 w-full text-left text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors font-bold text-sm mb-2 disabled:opacity-50"
        >
          <RefreshCw size={18} strokeWidth={2.5} className={syncing ? 'animate-spin' : ''} />
          Sincronizar Cadastros
        </button>
        <button 
            onClick={handleLogout} 
            className="flex items-center gap-3 px-4 py-3 w-full text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors font-bold text-sm"
        >
          <LogOut size={18} strokeWidth={2.5} /> 
          Sair do Sistema
        </button>
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="w-64 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 hidden md:flex flex-col h-screen sticky top-0 transition-all z-30 shadow-sm">
      <SidebarPanel />
    </aside>
  );
}

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className={`fixed inset-0 z-40 md:hidden ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-slate-900/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`absolute left-0 top-0 h-full w-72 bg-white dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 shadow-xl transform transition-transform ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <SidebarPanel onNavigate={onClose} showClose />
      </aside>
    </div>
  );
}