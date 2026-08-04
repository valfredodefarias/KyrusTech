export interface RouteRule {
  permissions: string[];
  requiredApps?: string[];
  defaultLabel?: string;
  defaultIcon?: string;
}

export const ROUTE_RULES: Record<string, RouteRule> = {
  '/apps': { permissions: ['page:configuracoes:view'], defaultLabel: 'Aplicativos', defaultIcon: 'Grid' },
  '/apps/ifood': { permissions: ['page:ifood:view'], requiredApps: ['ifood'], defaultLabel: 'iFood', defaultIcon: 'Utensils' },
  '/apps/:tab': { permissions: ['page:integracoes:view'], defaultLabel: 'Aplicativos', defaultIcon: 'Grid' },
  '/apps/movimentacao-pdv': { permissions: ['page:importacao:view'], defaultLabel: 'Movimentação PDV', defaultIcon: 'Calculator' },
  '/produtos': { permissions: ['PDV_VER_TODAS_VENDAS', 'PDV_SER_VENDEDOR'], defaultLabel: 'Produtos', defaultIcon: 'Package' },
  '/home': { permissions: ['page:home:view'], defaultLabel: 'Visão Geral', defaultIcon: 'Home' },
  '/boletim': { permissions: ['page:boletim:view'], defaultLabel: 'Boletim', defaultIcon: 'FileText' },
  '/contas': { permissions: ['page:contas:view'], defaultLabel: 'Contas', defaultIcon: 'Wallet' },
  '/lancamentos': { permissions: ['page:lancamentos:view'], defaultLabel: 'Lançamentos', defaultIcon: 'List' },
  '/caixa': { permissions: ['page:caixa:view'], defaultLabel: 'Caixa', defaultIcon: 'PiggyBank' },
  '/cartoes': { permissions: ['page:cartoes:view'], defaultLabel: 'Cartões', defaultIcon: 'CreditCard' },
  '/conciliacao-cartoes': { permissions: ['page:cartoes:view'], defaultLabel: 'Conciliadora', defaultIcon: 'CreditCard' },
  '/orcamentos': { permissions: ['page:dre:view'], defaultLabel: 'Orçamentos', defaultIcon: 'FileSpreadsheet' },
  '/budget': { permissions: ['page:dre:view'], defaultLabel: 'Budget', defaultIcon: 'PieChart' },
  '/dre': { permissions: ['page:dre:view'], defaultLabel: 'DRE', defaultIcon: 'BarChart' },
  '/comissoes': { permissions: ['page:boletim:view', 'PDV_SER_VENDEDOR', 'PDV_VER_TODAS_VENDAS'], defaultLabel: 'Comissões', defaultIcon: 'DollarSign' },
  '/consultor': { permissions: ['page:consultor:view'], defaultLabel: 'Consultor', defaultIcon: 'UserCog' },
  '/auditoria': { permissions: ['page:auditoria:view'], defaultLabel: 'Auditoria', defaultIcon: 'Shield' },
  '/config': { permissions: ['page:configuracoes:view'], defaultLabel: 'Configurações', defaultIcon: 'Settings' },
  '/importacao': { permissions: ['page:importacao:view'], defaultLabel: 'Importação', defaultIcon: 'Upload' },
  '/importacao_nfe': { permissions: ['page:importacao_nfe:view', 'page:importacao:view'], defaultLabel: 'NFe', defaultIcon: 'FileJson' },
  '/importacao_ofx': { permissions: ['page:importacao_ofx:view'], defaultLabel: 'OFX', defaultIcon: 'FileCode' },
  '/importacao_interessados': { permissions: ['page:importacao_entidades:view'], defaultLabel: 'Importar Clientes', defaultIcon: 'Users' },
  '/integracoes/asaas': { permissions: ['page:integracoes:view'], defaultLabel: 'Asaas', defaultIcon: 'CreditCard' },
  '/pdv': { 
    permissions: [
      'PDV_VER_TODAS_VENDAS',
      'PDV_SER_VENDEDOR',
      'PDV_REALIZAR_SANGRIA',
      'PDV_CANCELAR_VENDA',
      'PDV_CONCEDER_DESCONTO',
    ],
    defaultLabel: 'PDV',
    defaultIcon: 'Monitor'
  },
  '/pdv/fechamento': { permissions: ['PDV_VER_TODAS_VENDAS'], defaultLabel: 'Fechamento PDV', defaultIcon: 'Lock' },
  '/pdv/importar': { permissions: ['PDV_VER_TODAS_VENDAS'], defaultLabel: 'Importar PDV', defaultIcon: 'Upload' },
  '/centro-custo': { permissions: ['page:centro_custo:view'], defaultLabel: 'Centro de Custo', defaultIcon: 'Folder' },
  '/entidades': { permissions: ['page:entidades:view'], defaultLabel: 'Entidades', defaultIcon: 'Users' },
  '/entidades/clientes': { permissions: ['page:entidades:view'], defaultLabel: 'Clientes', defaultIcon: 'Users' },
  '/entidades/fornecedores': { permissions: ['page:entidades:view'], defaultLabel: 'Fornecedores', defaultIcon: 'Truck' }
};

export function hasPathPermission(path: string, user: { permissions?: string[] | null } | null): boolean {
  if (!user) return false;
  const permissions = user.permissions || [];
  if (permissions.includes('*')) return true;
  
  const basePath = path.split('?')[0];
  const rule = ROUTE_RULES[basePath];
  if (!rule) return true;
  
  return rule.permissions.some((p) => permissions.includes(p));
}

export function getFirstAllowedPath(user: { permissions?: string[] | null } | null): string {
  if (!user) return "/login";
  const permissions = user.permissions || [];
  if (permissions.includes('*')) return "/home";
  
  const order = [
    '/home',
    '/boletim',
    '/lancamentos',
    '/contas',
    '/caixa',
    '/cartoes',
    '/pdv',
    '/apps/movimentacao-pdv',
    '/apps/ifood',
    '/dre',
    '/importacao',
    '/config',
    '/consultor',
    '/auditoria'
  ];
  
  for (const path of order) {
    if (hasPathPermission(path, user)) {
      return path;
    }
  }
  
  for (const path of Object.keys(ROUTE_RULES)) {
    if (hasPathPermission(path, user)) {
      return path;
    }
  }
  
  return "/login";
}
