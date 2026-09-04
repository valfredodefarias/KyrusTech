  type ConfigTab = 'EMPRESA' | 'USUARIO' | 'SEGURANCA' | 'INTERESSADOS' | 'PLANO' | 'IMPORTACAO' | 'FINANCEIRO' | 'RBAC' | 'NFSTOCK' | 'PDV' | 'COMISSOES';
  const [searchParams, setSearchParams] = useSearchParams();
  const [menuCollapsed, setMenuCollapsed] = useState(false);

  const isConfigTab = (value: string | null): value is ConfigTab => {
    return value === 'EMPRESA' || value === 'USUARIO' || value === 'SEGURANCA' || value === 'INTERESSADOS' || value === 'PLANO' || value === 'IMPORTACAO' || value === 'FINANCEIRO' || value === 'RBAC' || value === 'NFSTOCK' || value === 'PDV' || value === 'COMISSOES';
  };

  const queryTab = searchParams.get('tab');
  const activeTab = isConfigTab(queryTab) ? queryTab : 'EMPRESA';

  const handleTabChange = (tabKey: ConfigTab) => {
    const next = new URLSearchParams(searchParams);
    if (tabKey === 'EMPRESA') {
      next.delete('tab');
    } else {
      next.set('tab', tabKey);
    }
    setSearchParams(next, { replace: true });
  };


  const tabs: Array<{ key: ConfigTab; label: string; description: string; icon: any }> = [
    { key: 'EMPRESA', label: 'Minha Empresa', description: 'Identidade visual e dados da conta', icon: Building2 },
    { key: 'USUARIO', label: 'Meu Usuário', description: 'Foto e dados da conta', icon: Camera },
    { key: 'SEGURANCA', label: 'Segurança e Acessos', description: 'Sessões ativas e histórico', icon: Shield },
    { key: 'INTERESSADOS', label: 'Interessados', description: 'Clientes, fornecedores e contatos', icon: Users },
    { key: 'PLANO', label: 'Plano de Contas', description: 'Estrutura e organização contábil', icon: Layers },
    { key: 'IMPORTACAO', label: 'Importação de Dados', description: 'Entradas em lote e conciliações', icon: UploadCloud },
    { key: 'FINANCEIRO', label: 'Exportação Financeira', description: 'Extração por conta e período', icon: Download },
    { key: 'PDV', label: 'Configurações do PDV', description: 'Mapeamento e liquidação de vendas', icon: ShoppingBag },
    { key: 'NFSTOCK', label: 'NFStock', description: 'Credenciais por centro de custo', icon: UploadCloud },
    { key: 'RBAC', label: 'Perfis de Acesso', description: 'Permissões e governança', icon: Layers },
    { key: 'COMISSOES', label: 'Comissões e Metas', description: 'Regras de comissão e metas de vendas', icon: DollarSign },
  ];

  const getTabClass = (tab: ConfigTab) => {
    const active = activeTab === tab;
    return `flex w-full rounded-xl border transition ${menuCollapsed ? 'items-center justify-center px-2 py-2.5' : 'items-start gap-3 px-3 py-3 text-left'} ${active ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300' : 'border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'}`;
  };

