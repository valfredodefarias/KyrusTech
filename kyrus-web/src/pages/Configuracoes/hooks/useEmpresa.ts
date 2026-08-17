import { useState, useEffect } from 'react';
import { api, normalizeListResponse, toPublicAssetUrl } from '../../../services/api';
import { useAuthStore, type EmpresaInfo } from '../../../store/authStore';
import { useLookupStore } from '../../../store/lookupStore';

const COMPANY_RESET_PERMISSION = 'empresa:reset_base';

interface UserInfo {
  id: number;
  email: string;
  nome?: string | null;
  foto_url?: string | null;
  is_consultor?: boolean;
  consultor_role?: string;
  permissions?: string[] | null;
}

interface CategoriaNfeConfig {
  id: number;
  nome: string;
  tipo?: string | null;
  permite_lancamentos?: boolean;
  eh_cabecalho?: boolean;
}

function hasPermission(user: UserInfo | null, permission: string) {
  const permissions = user?.permissions || [];
  return permissions.includes('*') || permissions.includes(permission);
}

export function useEmpresa() {
  const storeUser = useAuthStore((state) => state.user);
  const storeEmpresa = useAuthStore((state) => state.empresa);
  const setGlobalEmpresa = useAuthStore((state) => state.setEmpresa);

  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(storeEmpresa);
  const [user, setUser] = useState<UserInfo | null>(storeUser as any);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [cor, setCor] = useState(storeEmpresa?.cor_primaria || '#2563eb');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(storeEmpresa?.logo_url ? toPublicAssetUrl(storeEmpresa.logo_url) : null);
  const [categoriasDespesaNfe, setCategoriasDespesaNfe] = useState<CategoriaNfeConfig[]>([]);
  const [categoriaNfeFornecedoresId, setCategoriaNfeFornecedoresId] = useState(storeEmpresa?.categoria_nfe_fornecedores_id ? String(storeEmpresa.categoria_nfe_fornecedores_id) : '');
  const [loadingCategoriasNfe, setLoadingCategoriasNfe] = useState(false);
  const invalidatePlanoContas = useLookupStore((state) => state.invalidatePlanoContas);
  
  const canResetEmpresa = hasPermission(user, COMPANY_RESET_PERMISSION) && user?.email === 'cirocaue12@gmail.com';

  useEffect(() => { loadEmpresa(); }, []);

  useEffect(() => {
    if (storeUser) setUser(storeUser as any);
  }, [storeUser]);

  useEffect(() => {
    if (storeEmpresa) {
      setEmpresa(storeEmpresa);
      if (storeEmpresa.cor_primaria) setCor(storeEmpresa.cor_primaria);
      setCategoriaNfeFornecedoresId(storeEmpresa.categoria_nfe_fornecedores_id ? String(storeEmpresa.categoria_nfe_fornecedores_id) : '');
      if (storeEmpresa.logo_url) setPreviewUrl(toPublicAssetUrl(storeEmpresa.logo_url));
    }
  }, [storeEmpresa]);

  useEffect(() => {
    if (logoFile) {
        const url = URL.createObjectURL(logoFile);
        setPreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }
  }, [logoFile]);

  async function loadEmpresa() {
    try {
      setLoadingCategoriasNfe(true);
      try {
        const { data: planoContasData } = await api.get('/plano-contas/');
        const normalized = normalizeListResponse<CategoriaNfeConfig>(planoContasData);
        
        const categoriasDespesa = normalized
          .filter((item) => String(item.tipo || '').toUpperCase().startsWith('D'))
          .filter((item) => item.permite_lancamentos !== false)
          .filter((item) => item.eh_cabecalho !== true)
          .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
        setCategoriasDespesaNfe(categoriasDespesa);
      } catch (error) {
        console.error(error);
        setCategoriasDespesaNfe([]);
      } finally {
        setLoadingCategoriasNfe(false);
      }
    } catch (e) { 
      console.error(e); 
    } finally { 
      setLoading(false); 
    }
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        setLogoFile(e.target.files[0]);
    }
  };

  async function handleSave() {
    if (!empresa) return;
    setSaving(true);
    try {
        let empresaSalva = empresa;

        if (logoFile) {
             const fdLogo = new FormData();
             fdLogo.append('file', logoFile);
             const resLogo = await api.post<EmpresaInfo>(`/empresas/${empresa.id}/logo`, fdLogo);
             empresaSalva = resLogo.data;
        }
        
        const resPatch = await api.patch<EmpresaInfo>(`/empresas/${empresa.id}`, {
          cor_primaria: cor,
          categoria_nfe_fornecedores_id: categoriaNfeFornecedoresId ? Number(categoriaNfeFornecedoresId) : null,
        });
        empresaSalva = resPatch.data;

        setGlobalEmpresa(empresaSalva);
        document.documentElement.style.setProperty('--color-primary', cor);
        
        alert("Configurações salvas com sucesso!");
    } catch (e) { 
        console.error(e);
        alert("Erro ao salvar configurações."); 
    } finally { 
        setSaving(false); 
    }
  }

  async function handleResetEmpresa() {
    if (!empresa || !canResetEmpresa || resetting) return;

    const confirmed = window.confirm(
      'Esse reset vai apagar definitivamente entidades, lançamentos, contas, cartões, integrações bancárias, centros de custo e plano de contas da empresa. O nome, a logo e os usuários com acesso serão mantidos. Deseja continuar?'
    );
    if (!confirmed) return;

    const typed = window.prompt('Digite RESETAR EMPRESA para confirmar o reset total da base financeira.');
    if (typed !== 'RESETAR EMPRESA') {
      alert('Confirmação inválida. O reset foi cancelado.');
      return;
    }

    setResetting(true);
    try {
      const { data } = await api.post(`/empresas/${empresa.id}/resetar-base`);
      invalidatePlanoContas();
      alert(data?.message || 'Empresa resetada com sucesso.');
      window.location.reload();
    } catch (error: any) {
      console.error(error);
      alert(error?.response?.data?.detail || 'Erro ao resetar a empresa.');
    } finally {
      setResetting(false);
    }
  }

  return {
    loadEmpresa,
    empresa, user, loading, saving, resetting, cor, setCor, previewUrl,
    categoriasDespesaNfe, categoriaNfeFornecedoresId, setCategoriaNfeFornecedoresId, loadingCategoriasNfe,
    canResetEmpresa, handleLogoChange, handleSave, handleResetEmpresa
  };
}
