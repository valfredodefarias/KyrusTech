import { useState, useEffect } from 'react';
import { api, normalizeListResponse } from '../../../services/api';

const NFSTOCK_FORCE_SYNC_PERMISSION = 'integracoes:sync';

interface CentroCustoOption {
  id: number;
  nome: string;
  codigo?: string | null;
  status?: string | null;
}

interface IntegracaoNfstock {
  id: number;
  nome: string;
  tipo: string;
  ativo: boolean;
  centro_custo_id?: number | null;
  nfstock_username?: string | null;
  nfstock_select_company?: boolean;
  nfstock_company_name?: string | null;
}

interface UserInfo {
  id: number;
  permissions?: string[] | null;
}

function hasPermission(user: UserInfo | null, permission: string) {
  const permissions = user?.permissions || [];
  return permissions.includes('*') || permissions.includes(permission);
}

export function useIntegracoes() {
  const [centros, setCentros] = useState<CentroCustoOption[]>([]);
  const [integracoes, setIntegracoes] = useState<IntegracaoNfstock[]>([]);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forcingSync, setForcingSync] = useState(false);

  const [centroCustoId, setCentroCustoId] = useState('');
  const [nome, setNome] = useState('NFStock');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [selectCompany, setSelectCompany] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [forceSyncLogin, setForceSyncLogin] = useState('');
  
  const canForceSyncByLogin = hasPermission(user, NFSTOCK_FORCE_SYNC_PERMISSION);

  async function loadData() {
    setLoading(true);
    try {
      const [{ data: centrosData }, { data: integracoesData }, { data: userData }] = await Promise.all([
        api.get<CentroCustoOption[]>('/centro-custo/'),
        api.get<IntegracaoNfstock[]>('/integracoes-bancarias/'),
        api.get<UserInfo>('/usuarios/me'),
      ]);

      const centrosAtivos = normalizeListResponse<CentroCustoOption>(centrosData)
        .filter((item) => String(item.status || 'ATIVO').toUpperCase() === 'ATIVO')
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

      const nfstockList = normalizeListResponse<IntegracaoNfstock>(integracoesData)
        .filter((item) => String(item.tipo || '').toUpperCase() === 'NFSTOCK');

      setUser(userData);
      setCentros(centrosAtivos);
      setIntegracoes(nfstockList);

      if (!centroCustoId && centrosAtivos.length > 0) {
        setCentroCustoId(String(centrosAtivos[0].id));
      }
    } catch (error) {
      console.error(error);
      alert('Erro ao carregar configuração NFStock.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncByLogin() {
    if (!canForceSyncByLogin) {
      alert('Você não tem permissão para sincronizar por login.');
      return;
    }

    const login = forceSyncLogin.trim();
    if (!login) {
      alert('Informe o login NFStock para sincronizar.');
      return;
    }

    setForcingSync(true);
    try {
      await api.post('/integracoes-bancarias/nfstock/sincronizar-por-login', { username: login });
      alert('Busca de notas fiscais iniciada/concluída para o login informado.');
      await loadData();
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao sincronizar por login.');
    } finally {
      setForcingSync(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleSave() {
    if (!centroCustoId) {
      alert('Selecione o centro de custo.');
      return;
    }
    if (!username.trim() || !password.trim()) {
      alert('Informe usuário e senha do NFStock.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/integracoes-bancarias/nfstock/configurar', {
        nome: nome.trim() || 'NFStock',
        username: username.trim(),
        password: password,
        centro_custo_id: Number(centroCustoId),
        select_company: selectCompany,
        company_name: companyName.trim() || null,
        ativo,
      });
      setPassword('');
      alert('Integração NFStock salva. Agendamento diário configurado para 1:00 AM.');
      await loadData();
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao salvar integração NFStock.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncNow(id: number) {
    try {
      await api.post(`/integracoes-bancarias/${id}/sincronizar`);
      alert('Sincronização NFStock iniciada/concluída.');
      await loadData();
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao sincronizar NFStock.');
    }
  }

  return {
    loadData,
    centros, integracoes, loading, saving, forcingSync,
    centroCustoId, setCentroCustoId, nome, setNome, username, setUsername, password, setPassword,
    selectCompany, setSelectCompany, companyName, setCompanyName, ativo, setAtivo,
    forceSyncLogin, setForceSyncLogin, canForceSyncByLogin,
    handleSave, handleSyncNow, handleSyncByLogin
  };
}
