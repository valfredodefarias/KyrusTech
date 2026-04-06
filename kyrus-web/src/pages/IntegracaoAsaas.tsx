import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, normalizeListResponse } from '../services/api';
import { RefreshCw, Link as LinkIcon, Loader2, Check, X, Plug } from 'lucide-react';

interface Conta {
  id: number;
  nome: string;
  tipo?: string | null;
  status?: string | null;
  saldo_inicial?: number;
  saldo_atual?: number;
  banco?: string;
  agencia?: string | null;
  conta_numero?: string | null;
  conta_digito?: string | null;
  centro_custo_id?: number | null;
  tipo_integracao?: string | null;
}


interface PlanoContas {
  id: number;
  nome: string;
  tipo: string;
  permite_lancamentos?: boolean;
}

interface IntegracaoBancaria {
  id: number;
  nome: string;
  tipo: string;
  ambiente: string;
  ativo: boolean;
  token_configurado?: boolean;
  ultima_sincronizacao?: string | null;
  conta_id?: number | null;
  centro_custo_id?: number | null;
}

interface TipoAsaas {
  codigo: string;
  descricao: string;
  mapeado?: boolean;
  categoria_mapeada?: string | null;
}

interface MapeamentoCategoria {
  id: number;
  categoria_externa: string;
  plano_contas_id: number;
}

interface CobrancaAsaas {
  id: string;
  customer?: string;
  description?: string;
  status?: string;
  dueDate?: string;
  value?: number;
}

interface AssinaturaAsaas {
  id: string;
  customer?: string;
  description?: string;
  status?: string;
  nextDueDate?: string;
  value?: number;
}

interface SaldoAsaasResumo {
  saldo_asaas: number;
  saldo_bloqueado: number;
  saldo_disponivel: number;
  atualizado_em?: string;
  conta_vinculada_id?: number | null;
  conta_vinculada_nome?: string | null;
}

export function IntegracaoAsaas() {
  const [searchParams] = useSearchParams();
  const contaIdParam = searchParams.get('conta_id');

  const [loading, setLoading] = useState(true);
  const [contas, setContas] = useState<Conta[]>([]);
  const [categorias, setCategorias] = useState<PlanoContas[]>([]);
  const [integracoes, setIntegracoes] = useState<IntegracaoBancaria[]>([]);
  const [selectedIntegracaoId, setSelectedIntegracaoId] = useState<number | null>(null);
  const [tiposAsaas, setTiposAsaas] = useState<TipoAsaas[]>([]);
  const [mapeamentos, setMapeamentos] = useState<MapeamentoCategoria[]>([]);
  const [mappingSelections, setMappingSelections] = useState<Record<string, number | ''>>({});
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cobrancas, setCobrancas] = useState<CobrancaAsaas[]>([]);
  const [assinaturas, setAssinaturas] = useState<AssinaturaAsaas[]>([]);
  const [contasReceberAbertas, setContasReceberAbertas] = useState<CobrancaAsaas[]>([]);
  const [contasReceberAtrasadas, setContasReceberAtrasadas] = useState<CobrancaAsaas[]>([]);
  const [limiteCobrancas, setLimiteCobrancas] = useState(20);
  const [limiteAssinaturas, setLimiteAssinaturas] = useState(20);
  const [limiteContasReceber, setLimiteContasReceber] = useState(20);
  const [saldoAsaas, setSaldoAsaas] = useState<SaldoAsaasResumo | null>(null);
  const [loadingSaldoAsaas, setLoadingSaldoAsaas] = useState(false);

  const [formNome, setFormNome] = useState('Asaas Principal');
  const [formAmbiente] = useState('PRODUCAO');
  const [formToken, setFormToken] = useState('');
  const [formContaId, setFormContaId] = useState<number | ''>(contaIdParam ? parseInt(contaIdParam) : '');
  const [showTokenEditor, setShowTokenEditor] = useState(false);
  const [novoToken, setNovoToken] = useState('');

  const contasVinculaveis = useMemo(
    () => contas.filter(c => String(c.status || 'ATIVO').toUpperCase() === 'ATIVO' && String(c.tipo || '').toUpperCase() !== 'CAIXA'),
    [contas]
  );

  const categoriasLancaveis = useMemo(
    () => categorias.filter((categoria) => categoria.permite_lancamentos !== false),
    [categorias]
  );

  const integracoesAsaas = useMemo(
    () => integracoes.filter(i => (i.tipo || '').toUpperCase() === 'ASAAS'),
    [integracoes]
  );

  const integracaoSelecionada = useMemo(
    () => integracoesAsaas.find((item) => item.id === selectedIntegracaoId) || null,
    [integracoesAsaas, selectedIntegracaoId]
  );

  const integracaoAtiva = integracaoSelecionada || integracoesAsaas[0] || null;

  const contaVinculadaAtiva = useMemo(() => {
    if (!integracaoAtiva?.conta_id) return null;
    return contas.find((conta) => conta.id === integracaoAtiva.conta_id) || null;
  }, [contas, integracaoAtiva]);

  const saldoContaVinculada = Number(contaVinculadaAtiva?.saldo_atual ?? contaVinculadaAtiva?.saldo_inicial ?? 0);
  const saldoAsaasAtual = Number(saldoAsaas?.saldo_asaas ?? 0);
  const diferencaSaldo = saldoAsaas ? saldoContaVinculada - saldoAsaasAtual : null;

  const contaSelecionada = useMemo(() => {
    if (formContaId === '') return null;
    return contasVinculaveis.find(c => c.id === formContaId) || null;
  }, [formContaId, contasVinculaveis]);

  useEffect(() => {
    if (contasVinculaveis.length === 1 && formContaId === '') {
      setFormContaId(contasVinculaveis[0].id);
    }
  }, [contasVinculaveis, formContaId]);

  useEffect(() => {
    carregarDados();
  }, []);

  useEffect(() => {
    if (integracoesAsaas.length > 0 && !selectedIntegracaoId) {
      setSelectedIntegracaoId(integracoesAsaas[0].id);
    }
  }, [integracoesAsaas, selectedIntegracaoId]);

  useEffect(() => {
    if (!selectedIntegracaoId) return;
    carregarMapeamentos(selectedIntegracaoId);
    carregarTiposAsaas(selectedIntegracaoId);
    carregarCobrancas(selectedIntegracaoId, limiteCobrancas);
    carregarAssinaturas(selectedIntegracaoId, limiteAssinaturas);
    carregarContasReceber(selectedIntegracaoId, limiteContasReceber);
    carregarSaldoAsaas(selectedIntegracaoId);
  }, [selectedIntegracaoId, limiteCobrancas, limiteAssinaturas, limiteContasReceber]);

  async function carregarDados() {
    setLoading(true);
    try {
      const [resContas, resCategorias, resIntegracoes] = await Promise.all([
        api.get('/contas/'),
        api.get('/plano-contas/'),
        api.get('/integracoes-bancarias/')
      ]);
      setContas(normalizeListResponse<Conta>(resContas.data));
      setCategorias(normalizeListResponse<PlanoContas>(resCategorias.data));
      setIntegracoes(normalizeListResponse<IntegracaoBancaria>(resIntegracoes.data));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function carregarTiposAsaas(integracaoId: number) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/tipos-asaas`);
      setTiposAsaas(normalizeListResponse<TipoAsaas>(data));
    } catch (e) {
      console.error(e);
      setTiposAsaas([]);
    }
  }

  async function carregarMapeamentos(integracaoId: number) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/mapeamentos`);
      const mapeamentosNormalizados = normalizeListResponse<MapeamentoCategoria>(data).map((item) => ({
        ...item,
        categoria_externa: String(item.categoria_externa || '').trim().toUpperCase(),
      }));
      setMapeamentos(mapeamentosNormalizados);
      const nextSelections: Record<string, number | ''> = {};
      mapeamentosNormalizados.forEach((m) => {
        nextSelections[String(m.categoria_externa || '').trim().toUpperCase()] = m.plano_contas_id;
      });
      setMappingSelections(nextSelections);
    } catch (e) {
      console.error(e);
      setMapeamentos([]);
    }
  }

  async function carregarCobrancas(integracaoId: number, limit = 20) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/cobrancas`, {
        params: { limit }
      });
      setCobrancas(normalizeListResponse<CobrancaAsaas>(data));
    } catch (e) {
      console.error(e);
      setCobrancas([]);
    }
  }

  async function carregarAssinaturas(integracaoId: number, limit = 20) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/assinaturas`, {
        params: { limit }
      });
      setAssinaturas(normalizeListResponse<AssinaturaAsaas>(data));
    } catch (e) {
      console.error(e);
      setAssinaturas([]);
    }
  }

  async function carregarContasReceber(integracaoId: number, limit = 20) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/contas-receber`, {
        params: { limit }
      });
      setContasReceberAbertas(normalizeListResponse<CobrancaAsaas>(data?.abertas));
      setContasReceberAtrasadas(normalizeListResponse<CobrancaAsaas>(data?.atrasadas));
    } catch (e) {
      console.error(e);
      setContasReceberAbertas([]);
      setContasReceberAtrasadas([]);
    }
  }

  async function carregarSaldoAsaas(integracaoId: number) {
    setLoadingSaldoAsaas(true);
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/asaas/saldo`);
      setSaldoAsaas(data as SaldoAsaasResumo);
    } catch (e) {
      console.error(e);
      setSaldoAsaas(null);
    } finally {
      setLoadingSaldoAsaas(false);
    }
  }

  async function handleCriarIntegracao() {
    if (!formNome || !formToken) return alert('Preencha nome e token do Asaas.');
    if (!formContaId) return alert('Selecione a conta bancária para vincular ao Asaas.');

    setSaving(true);
    try {
      const centroId = contaSelecionada?.centro_custo_id || null;
      const payload = {
        nome: formNome,
        tipo: 'ASAAS',
        ambiente: formAmbiente,
        token: formToken,
        conta_id: contaSelecionada?.id || null,
        centro_custo_id: centroId,
        ativo: true,
        sincronizar_automaticamente: true,
        intervalo_sincronizacao_minutos: 60,
        usar_categoria_a_categorizar: true
      };
      const { data } = await api.post('/integracoes-bancarias/', payload);
      setFormToken('');
      await carregarDados();
      if (data?.id) {
        setSelectedIntegracaoId(data.id);
      }
      alert('Integração Asaas criada com sucesso. O token foi salvo com segurança e não será exibido novamente.');
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar integração.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDesvincularConta() {
    if (!selectedIntegracaoId) return;
    if (!window.confirm('Deseja realmente desvincular a conta bancária desta integração Asaas?')) return;

    setSaving(true);
    try {
      await api.patch(`/integracoes-bancarias/${selectedIntegracaoId}`, {
        conta_id: null,
        centro_custo_id: null,
      });
      await carregarDados();
      alert('Conta desvinculada com sucesso.');
    } catch (e) {
      console.error(e);
      alert('Erro ao desvincular conta.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAtualizarToken() {
    if (!selectedIntegracaoId) return;
    if (!novoToken.trim()) return alert('Informe o novo token do Asaas.');

    setSaving(true);
    try {
      await api.patch(`/integracoes-bancarias/${selectedIntegracaoId}`, {
        token: novoToken.trim(),
      });
      setNovoToken('');
      setShowTokenEditor(false);
      await carregarDados();
      alert('Token atualizado com sucesso.');
    } catch (e) {
      console.error(e);
      alert('Erro ao atualizar token.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSincronizar() {
    if (!selectedIntegracaoId) return;
    setSyncing(true);
    try {
      const { data } = await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/sincronizar`);
      const criados = Number(data?.lancamentos_criados || 0);
      const atualizados = Number(data?.lancamentos_atualizados || 0);
      const processado = Number(data?.total_processado || 0);
      const dataInicio = data?.data_inicio_utilizada ? String(data.data_inicio_utilizada) : 'início padrão da API';
      const ultimaConciliacao = data?.data_ultima_conciliacao ? String(data.data_ultima_conciliacao) : 'sem conciliação prévia';
      await carregarSaldoAsaas(selectedIntegracaoId);
      alert(
        `Sincronização concluída.\nProcessados: ${processado}\nCriados: ${criados}\nAtualizados: ${atualizados}\nInício usado: ${dataInicio}\nÚltima conciliação: ${ultimaConciliacao}`
      );
    } catch (e) {
      console.error(e);
      alert('Erro ao sincronizar.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSalvarMapeamento(codigo: string) {
    if (!selectedIntegracaoId) return;
    const codigoNormalizado = String(codigo || '').trim().toUpperCase();
    const planoId = mappingSelections[codigoNormalizado];
    if (!planoId) return alert('Selecione uma categoria.');

    try {
      const existente = mapeamentos.find(m => String(m.categoria_externa || '').trim().toUpperCase() === codigoNormalizado);
      if (existente && existente.plano_contas_id !== planoId) {
        await api.delete(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos/${existente.id}`);
      }
      if (!existente || existente.plano_contas_id !== planoId) {
        await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos`, {
          categoria_externa: codigoNormalizado,
          plano_contas_id: planoId
        });
      }
      await carregarMapeamentos(selectedIntegracaoId);
      await carregarTiposAsaas(selectedIntegracaoId);
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar mapeamento.');
    }
  }

  async function handleRemoverMapeamento(codigo: string) {
    if (!selectedIntegracaoId) return;
    const codigoNormalizado = String(codigo || '').trim().toUpperCase();
    const existente = mapeamentos.find(m => String(m.categoria_externa || '').trim().toUpperCase() === codigoNormalizado);
    if (!existente) return;
    try {
      await api.delete(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos/${existente.id}`);
      await carregarMapeamentos(selectedIntegracaoId);
      await carregarTiposAsaas(selectedIntegracaoId);
    } catch (e) {
      console.error(e);
      alert('Erro ao remover mapeamento.');
    }
  }

  const contaLabel = (conta: Conta) => {
    const agencia = conta.agencia ? `Ag ${conta.agencia}` : 'Ag -';
    const numero = conta.conta_numero ? `Cc ${conta.conta_numero}${conta.conta_digito ? '-' + conta.conta_digito : ''}` : 'Cc -';
    return `${conta.nome} (${conta.banco || 'Asaas'}) - ${agencia} / ${numero}`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <LinkIcon className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white">Integração Asaas</h2>
            <p className="text-sm text-slate-400">Token seguro, mapeamento de categorias e sincronização financeira.</p>
          </div>
        </div>
        <button
          onClick={carregarDados}
          className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Configuração da integração</h3>

        {contasVinculaveis.length === 0 && (
          <div className="p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500">
            Crie ao menos uma conta bancária ativa em Contas para vincular ao Asaas.
          </div>
        )}

        {integracoesAsaas.length === 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Nome</label>
                <input
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                  placeholder="Ex: Asaas Produção"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Ambiente</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  Produção
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Token Asaas</label>
                <input
                  type="password"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  value={formToken}
                  onChange={e => setFormToken(e.target.value)}
                  placeholder="Token de API"
                />
                <p className="text-[11px] text-slate-400 mt-1">Solicitado apenas nesta configuração inicial. O backend guarda o token criptografado.</p>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta bancária vinculada</label>
                <select
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  value={formContaId}
                  onChange={e => setFormContaId(e.target.value ? parseInt(e.target.value) : '')}
                >
                  <option value="">Selecione...</option>
                  {contasVinculaveis.map(conta => (
                    <option key={conta.id} value={conta.id}>{contaLabel(conta)}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleCriarIntegracao}
              disabled={saving || contasVinculaveis.length === 0}
              className="px-5 py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
              Conectar Asaas
            </button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-200">
              Integração conectada. O token fica salvo com criptografia e não precisa ser informado novamente no dia a dia.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Integração ativa</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  {integracaoAtiva ? `${integracaoAtiva.nome} (${integracaoAtiva.ambiente})` : 'Integração Asaas'}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Token</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  {integracaoAtiva?.token_configurado ? 'Configurado com segurança' : 'Não configurado'}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta bancária vinculada</label>
                <div className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                  {contaVinculadaAtiva ? contaLabel(contaVinculadaAtiva) : 'Nenhuma conta vinculada'}
                </div>
              </div>
              <button
                onClick={handleDesvincularConta}
                disabled={saving || !selectedIntegracaoId || !integracaoAtiva?.conta_id}
                className="px-4 py-3 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 disabled:opacity-60"
              >
                Desvincular conta
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Conferência de saldo Asaas x ERP</p>
                <button
                  type="button"
                  onClick={() => selectedIntegracaoId && carregarSaldoAsaas(selectedIntegracaoId)}
                  disabled={loadingSaldoAsaas || !selectedIntegracaoId}
                  className="text-xs font-bold text-blue-600 hover:underline disabled:opacity-60"
                >
                  {loadingSaldoAsaas ? 'Atualizando...' : 'Atualizar saldo'}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] uppercase font-bold text-slate-500">Saldo Asaas</div>
                  <div className="text-lg font-black text-slate-900 dark:text-white">
                    {saldoAsaasAtual.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] uppercase font-bold text-slate-500">Saldo no ERP (conta vinculada)</div>
                  <div className="text-lg font-black text-slate-900 dark:text-white">
                    {saldoContaVinculada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="text-[11px] uppercase font-bold text-slate-500">Diferença (ERP - Asaas)</div>
                  <div className={`text-lg font-black ${diferencaSaldo !== null && Math.abs(diferencaSaldo) > 0.009 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
                    {(diferencaSaldo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                </div>
              </div>
              {saldoAsaas?.atualizado_em ? (
                <p className="text-[11px] text-slate-500">Atualizado em {new Date(saldoAsaas.atualizado_em).toLocaleString('pt-BR')}</p>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Reconfigurar token (opcional)</p>
                <button
                  type="button"
                  onClick={() => setShowTokenEditor((prev) => !prev)}
                  className="text-xs font-bold text-blue-600 hover:underline"
                >
                  {showTokenEditor ? 'Fechar' : 'Atualizar token'}
                </button>
              </div>

              {showTokenEditor ? (
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Novo token Asaas</label>
                    <input
                      type="password"
                      className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      value={novoToken}
                      onChange={e => setNovoToken(e.target.value)}
                      placeholder="Novo token de API"
                    />
                  </div>
                  <button
                    onClick={handleAtualizarToken}
                    disabled={saving || !selectedIntegracaoId}
                    className="px-4 py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60"
                  >
                    Salvar token
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Mapeamento de categorias</h3>
            <p className="text-sm text-slate-400">Mapeie tipos financeiros do Asaas para o plano de contas.</p>
          </div>
          <button
            onClick={handleSincronizar}
            disabled={!selectedIntegracaoId || syncing}
            className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-60"
          >
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sincronizar agora
          </button>
        </div>

        {integracoesAsaas.length > 1 && (
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Integração</label>
            <select
              className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              value={selectedIntegracaoId || ''}
              onChange={e => setSelectedIntegracaoId(e.target.value ? parseInt(e.target.value) : null)}
            >
              <option value="">Selecione...</option>
              {integracoesAsaas.map(integ => (
                <option key={integ.id} value={integ.id}>{integ.nome} ({integ.ambiente})</option>
              ))}
            </select>
          </div>
        )}

        {!selectedIntegracaoId && (
          <div className="text-sm text-slate-400">Selecione uma integração Asaas para mapear.</div>
        )}

        {selectedIntegracaoId && (
          <div className="space-y-3">
            {tiposAsaas.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhum tipo carregado.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-300 text-xs uppercase tracking-[0.12em]">
                    <tr>
                      <th className="px-3 py-3 text-left">Tipo</th>
                      <th className="px-3 py-3 text-left">Descrição</th>
                      <th className="px-3 py-3 text-left">Categoria mapeada</th>
                      <th className="px-3 py-3 text-center">Status</th>
                      <th className="px-3 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {tiposAsaas.map((tipo) => {
                      const codigoNormalizado = String(tipo.codigo || '').trim().toUpperCase();
                      const selected = mappingSelections[codigoNormalizado] || '';
                      const mapped = mapeamentos.find((m) => String(m.categoria_externa || '').trim().toUpperCase() === codigoNormalizado);
                      return (
                        <tr key={tipo.codigo}>
                          <td className="px-3 py-3 font-mono text-[12px] text-slate-700 dark:text-slate-200">{tipo.codigo}</td>
                          <td className="px-3 py-3 text-slate-700 dark:text-slate-200">{tipo.descricao}</td>
                          <td className="px-3 py-3">
                            <select
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                              value={selected}
                              onChange={e => setMappingSelections(prev => ({ ...prev, [codigoNormalizado]: e.target.value ? parseInt(e.target.value) : '' }))}
                            >
                              <option value="">Selecione categoria...</option>
                              {categoriasLancaveis.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.nome}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${mapped ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                              {mapped ? 'Mapeado' : 'Pendente'}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 flex items-center gap-1"
                                onClick={() => handleSalvarMapeamento(codigoNormalizado)}
                              >
                                <Check className="w-3 h-3" />
                                Salvar
                              </button>
                              {mapped ? (
                                <button
                                  className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-200 flex items-center gap-1"
                                  onClick={() => handleRemoverMapeamento(codigoNormalizado)}
                                >
                                  <X className="w-3 h-3" />
                                  Remover
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Cobranças</h3>
            <p className="text-sm text-slate-400">Últimas cobranças do Asaas.</p>
          </div>
          <button
            onClick={() => selectedIntegracaoId && carregarCobrancas(selectedIntegracaoId, limiteCobrancas)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => setLimiteCobrancas(prev => prev + 20)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Ver mais
          </button>
        </div>

        {cobrancas.length === 0 ? (
          <div className="text-sm text-slate-400">Nenhuma cobrança encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 uppercase">
                <tr>
                  <th className="py-2 text-left">Descrição</th>
                  <th className="py-2 text-left">Vencimento</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {cobrancas.map(cobranca => (
                  <tr key={cobranca.id}>
                    <td className="py-2 text-slate-700 dark:text-slate-200">{cobranca.description || cobranca.id}</td>
                    <td className="py-2 text-slate-500">{cobranca.dueDate || '-'}</td>
                    <td className="py-2 text-slate-500">{cobranca.status || '-'}</td>
                    <td className="py-2 text-right text-slate-700 dark:text-slate-200">{cobranca.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Assinaturas</h3>
            <p className="text-sm text-slate-400">Assinaturas ativas do Asaas.</p>
          </div>
          <button
            onClick={() => selectedIntegracaoId && carregarAssinaturas(selectedIntegracaoId, limiteAssinaturas)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => setLimiteAssinaturas(prev => prev + 20)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Ver mais
          </button>
        </div>

        {assinaturas.length === 0 ? (
          <div className="text-sm text-slate-400">Nenhuma assinatura encontrada.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 uppercase">
                <tr>
                  <th className="py-2 text-left">Descrição</th>
                  <th className="py-2 text-left">Próximo vencimento</th>
                  <th className="py-2 text-left">Status</th>
                  <th className="py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {assinaturas.map(assinatura => (
                  <tr key={assinatura.id}>
                    <td className="py-2 text-slate-700 dark:text-slate-200">{assinatura.description || assinatura.id}</td>
                    <td className="py-2 text-slate-500">{assinatura.nextDueDate || '-'}</td>
                    <td className="py-2 text-slate-500">{assinatura.status || '-'}</td>
                    <td className="py-2 text-right text-slate-700 dark:text-slate-200">{assinatura.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-white">Contas a receber</h3>
            <p className="text-sm text-slate-400">Abertas e atrasadas no Asaas.</p>
          </div>
          <button
            onClick={() => selectedIntegracaoId && carregarContasReceber(selectedIntegracaoId, limiteContasReceber)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        <div className="flex items-center justify-end">
          <button
            onClick={() => setLimiteContasReceber(prev => prev + 20)}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Ver mais
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Abertas</h4>
            {contasReceberAbertas.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhuma cobrança aberta.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {contasReceberAbertas.map(item => (
                  <li key={item.id} className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">{item.description || item.id}</span>
                    <span className="text-slate-700 dark:text-slate-100 font-semibold">{item.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Atrasadas</h4>
            {contasReceberAtrasadas.length === 0 ? (
              <div className="text-sm text-slate-400">Nenhuma cobrança atrasada.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {contasReceberAtrasadas.map(item => (
                  <li key={item.id} className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">{item.description || item.id}</span>
                    <span className="text-slate-700 dark:text-slate-100 font-semibold">{item.value?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) || '-'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="px-6 py-4 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando...
          </div>
        </div>
      )}
    </div>
  );
}
