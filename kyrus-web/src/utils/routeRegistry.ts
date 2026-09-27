import { useAuthStore } from '../store/authStore';

export interface RouteRule {
  permissions: string[];
  requiredApps?: string[];
  defaultLabel?: string;
  defaultIcon?: string;
}

export const ROUTE_RULES: Record<string, RouteRule> = {
  '/home': { permissions: ['page:home:view'], defaultLabel: 'Visão Geral', defaultIcon: 'Home' },
  '/boletim': { permissions: ['page:boletim:view'], defaultLabel: 'Boletim', defaultIcon: 'FileText' },
  '/indicadores': { permissions: ['page:boletim:view'], defaultLabel: 'Indicadores', defaultIcon: 'Rows3' },
  '/compras': { permissions: ['page:boletim:view'], requiredApps: ['pdv_estoque'], defaultLabel: 'Compras', defaultIcon: 'ShoppingCart' },
  '/lancamentos': { permissions: ['page:lancamentos:view'], defaultLabel: 'Lançamentos', defaultIcon: 'List' },
  '/contas': { permissions: ['page:contas:view'], defaultLabel: 'Contas', defaultIcon: 'Wallet' },
  '/centro-custo': { permissions: ['page:centro_custo:view'], defaultLabel: 'Centro de Custo', defaultIcon: 'Folder' },
  '/entidades': { permissions: ['page:entidades:view'], defaultLabel: 'Entidades', defaultIcon: 'Users' },
  '/entidades/clientes': { permissions: ['page:entidades:view'], defaultLabel: 'Clientes', defaultIcon: 'Users' },
  '/entidades/fornecedores': { permissions: ['page:entidades:view'], defaultLabel: 'Fornecedores', defaultIcon: 'Truck' },
  '/cartoes': { permissions: ['page:cartoes:view'], defaultLabel: 'Cartões Corporativos', defaultIcon: 'CreditCard' },
  '/conciliacao-cartoes': { permissions: ['page:cartoes:view'], defaultLabel: 'Conciliadora', defaultIcon: 'CreditCard' },
  '/dre': { permissions: ['page:dre:view'], defaultLabel: 'DRE', defaultIcon: 'BarChart' },
  '/orcamentos': { permissions: ['page:dre:view'], defaultLabel: 'Orçamentos', defaultIcon: 'FileSpreadsheet' },
  '/budget': { permissions: ['page:dre:view'], defaultLabel: 'Budget', defaultIcon: 'PieChart' },
  '/caixa': { permissions: ['page:caixa:view'], requiredApps: ['pdv_estoque'], defaultLabel: 'Caixa', defaultIcon: 'PiggyBank' },
  '/comissoes': { permissions: ['page:boletim:view', 'PDV_SER_VENDEDOR', 'PDV_VER_TODAS_VENDAS'], requiredApps: ['pdv_estoque'], defaultLabel: 'Comissões', defaultIcon: 'DollarSign' },
  '/apps/movimentacao-pdv': { permissions: ['page:importacao:view'], requiredApps: ['movimentacao_pdv'], defaultLabel: 'Movimentação PDV', defaultIcon: 'Calculator' },
  '/apps/ifood': { permissions: ['page:ifood:view'], requiredApps: ['ifood'], defaultLabel: 'iFood', defaultIcon: 'Utensils' },
  '/pdv': { 
    permissions: [
      'PDV_VER_TODAS_VENDAS',
      'PDV_SER_VENDEDOR',
      'PDV_REALIZAR_SANGRIA',
      'PDV_CANCELAR_VENDA',
      'PDV_CONCEDER_DESCONTO',
    ],
    requiredApps: ['pdv_estoque'],
    defaultLabel: 'PDV',
    defaultIcon: 'Monitor'
  },
  '/produtos': { permissions: ['PDV_VER_TODAS_VENDAS', 'PDV_SER_VENDEDOR'], requiredApps: ['pdv_estoque'], defaultLabel: 'Produtos', defaultIcon: 'Package' },
  '/pdv/fechamento': { permissions: ['PDV_VER_TODAS_VENDAS'], requiredApps: ['pdv_estoque'], defaultLabel: 'Fechamento PDV', defaultIcon: 'Lock' },
  '/pdv/importar': { permissions: ['PDV_VER_TODAS_VENDAS'], requiredApps: ['pdv_estoque'], defaultLabel: 'Importar PDV', defaultIcon: 'Upload' },
  '/importacao': { permissions: ['page:importacao:view'], defaultLabel: 'Importação', defaultIcon: 'Upload' },
  '/importacao_nfe': { permissions: ['page:importacao_nfe:view', 'page:importacao:view'], requiredApps: ['pdv_estoque'], defaultLabel: 'NFe', defaultIcon: 'FileJson' },
  '/importacao_ofx': { permissions: ['page:importacao_ofx:view'], defaultLabel: 'OFX', defaultIcon: 'FileCode' },
  '/importacao_interessados': { permissions: ['page:importacao_entidades:view'], defaultLabel: 'Importar Clientes', defaultIcon: 'Users' },
  '/integracoes/asaas': { permissions: ['page:integracoes:view', 'page:configuracoes:view', 'page:contas:view', 'integracoes:view'], defaultLabel: 'Integração Asaas', defaultIcon: 'CreditCard' },
  '/apps/asaas': { permissions: ['page:integracoes:view', 'page:configuracoes:view', 'page:contas:view', 'integracoes:view', 'page:lancamentos:view', 'page:home:view'], defaultLabel: 'Asaas Cobranças', defaultIcon: 'CreditCard' },
  '/asaas': { permissions: ['page:integracoes:view', 'page:configuracoes:view', 'page:contas:view', 'integracoes:view', 'page:lancamentos:view', 'page:home:view'], defaultLabel: 'Asaas Cobranças', defaultIcon: 'CreditCard' },
  '/consultor': { permissions: ['page:consultor:view'], defaultLabel: 'Consultor', defaultIcon: 'UserCog' },
  '/auditoria': { permissions: ['page:auditoria:view'], defaultLabel: 'Auditoria', defaultIcon: 'Shield' },
  '/config': { permissions: ['page:configuracoes:view'], defaultLabel: 'Configurações', defaultIcon: 'Settings' },
  '/apps': { permissions: ['page:configuracoes:view'], defaultLabel: 'Aplicativos', defaultIcon: 'Grid' },
  '/apps/:tab': { permissions: ['page:integracoes:view'], defaultLabel: 'Aplicativos', defaultIcon: 'Grid' },
};

export const APP_ROUTE_ORDER: string[] = [
  '/home',
  '/boletim',
  '/indicadores',
  '/compras',
  '/lancamentos',
  '/contas',
  '/centro-custo',
  '/entidades',
  '/cartoes',
  '/conciliacao-cartoes',
  '/dre',
  '/orcamentos',
  '/budget',
  '/caixa',
  '/comissoes',
  '/apps/movimentacao-pdv',
  '/apps/ifood',
  '/apps/asaas',
  '/pdv',
  '/produtos',
  '/importacao',
  '/importacao_nfe',
  '/importacao_ofx',
  '/importacao_interessados',
  '/integracoes/asaas',
  '/consultor',
  '/auditoria',
  '/config',
  '/apps',
];

export function hasPathPermission(
  path: string,
  user: { permissions?: string[] | null; consultor_role?: string; is_consultor?: boolean } | null,
  empresa?: { pdv_config?: string | null } | null
): boolean {
  if (!user) return false;
  const permissions = user.permissions || [];
  const isSuper = permissions.includes('*') || (Boolean(user.is_consultor) && user.consultor_role === 'SUPER_CONSULTOR');
  
  const basePath = path.split('?')[0];
  const rule = ROUTE_RULES[basePath];
  if (!rule) return true;

  // Se a rota exige módulos/aplicativos específicos, checa se a empresa atual tem o app ativo
  if (rule.requiredApps && rule.requiredApps.length > 0) {
    const activeCompany = empresa ?? (typeof window !== 'undefined' ? useAuthStore.getState().empresa : null);
    try {
      const pdvConfig = JSON.parse(activeCompany?.pdv_config || '{}');
      const activeApps: string[] = Array.isArray(pdvConfig.active_apps) ? pdvConfig.active_apps : [];
      const hasApps = rule.requiredApps.every((app) => activeApps.includes(app));
      if (!hasApps) return false;
    } catch {
      return false;
    }
  }

  if (isSuper) return true;
  return rule.permissions.some((p) => permissions.includes(p));
}

export function getFirstAllowedPath(
  user: { permissions?: string[] | null; consultor_role?: string; is_consultor?: boolean } | null,
  empresa?: { pdv_config?: string | null } | null
): string {
  if (!user) return "/login";

  for (const path of APP_ROUTE_ORDER) {
    if (hasPathPermission(path, user, empresa)) {
      return path;
    }
  }

  for (const path of Object.keys(ROUTE_RULES)) {
    if (hasPathPermission(path, user, empresa)) {
      return path;
    }
  }

  return "/login";
}
