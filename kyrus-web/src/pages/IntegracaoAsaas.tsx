import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { RefreshCw, Link as LinkIcon, Loader2, Check, X, Plug } from 'lucide-react';

interface Conta {
  id: number;
  nome: string;
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

  const [formNome, setFormNome] = useState('Asaas Principal');
  const [formAmbiente] = useState('PRODUCAO');
  const [formToken, setFormToken] = useState('');
  const [formContaId, setFormContaId] = useState<number | ''>(contaIdParam ? parseInt(contaIdParam) : '');

  const contasAsaas = useMemo(
    () => contas.filter(c => (c.tipo_integracao || '').toUpperCase() === 'ASAAS'),
    [contas]
  );

  const integracoesAsaas = useMemo(
    () => integracoes.filter(i => (i.tipo || '').toUpperCase() === 'ASAAS'),
    [integracoes]
  );

  const contaSelecionada = useMemo(() => {
    if (formContaId === '') return null;
    return contasAsaas.find(c => c.id === formContaId) || null;
  }, [formContaId, contasAsaas]);

  useEffect(() => {
    if (contasAsaas.length === 1 && formContaId === '') {
      setFormContaId(contasAsaas[0].id);
    }
  }, [contasAsaas, formContaId]);

  useEffect(() => {
    carregarDados();
  }, []);

  useEffect(() => {
    if (integracoesAsaas.length === 1 && !selectedIntegracaoId) {
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
  }, [selectedIntegracaoId, limiteCobrancas, limiteAssinaturas, limiteContasReceber]);

  async function carregarDados() {
    setLoading(true);
    try {
      const [resContas, resCategorias, resIntegracoes] = await Promise.all([
        api.get('/contas/'),
        api.get('/plano-contas/'),
        api.get('/integracoes-bancarias/')
      ]);
      setContas(resContas.data || []);
      setCategorias(resCategorias.data || []);
      setIntegracoes(resIntegracoes.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function carregarTiposAsaas(integracaoId: number) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/tipos-asaas`);
      setTiposAsaas(data || []);
    } catch (e) {
      console.error(e);
      setTiposAsaas([]);
    }
  }

  async function carregarMapeamentos(integracaoId: number) {
    try {
      const { data } = await api.get(`/integracoes-bancarias/${integracaoId}/mapeamentos`);
      setMapeamentos(data || []);
      const nextSelections: Record<string, number | ''> = {};
      (data || []).forEach((m: MapeamentoCategoria) => {
        nextSelections[m.categoria_externa] = m.plano_contas_id;
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
      setCobrancas(data || []);
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
      setAssinaturas(data || []);
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
      setContasReceberAbertas(data?.abertas || []);
      setContasReceberAtrasadas(data?.atrasadas || []);
    } catch (e) {
      console.error(e);
      setContasReceberAbertas([]);
      setContasReceberAtrasadas([]);
    }
  }

  async function handleCriarIntegracao() {
    if (!formNome || !formToken) return alert('Preencha nome e token do Asaas.');
    if (contasAsaas.length > 1 && !formContaId) return alert('Selecione a conta Asaas.');

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
    } catch (e) {
      console.error(e);
      alert('Erro ao salvar integração.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSincronizar() {
    if (!selectedIntegracaoId) return;
    setSyncing(true);
    try {
      await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/sincronizar`);
      alert('Sincronização concluída.');
    } catch (e) {
      console.error(e);
      alert('Erro ao sincronizar.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleSalvarMapeamento(codigo: string) {
    if (!selectedIntegracaoId) return;
    const planoId = mappingSelections[codigo];
    if (!planoId) return alert('Selecione uma categoria.');

    try {
      const existente = mapeamentos.find(m => m.categoria_externa === codigo);
      if (existente && existente.plano_contas_id !== planoId) {
        await api.delete(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos/${existente.id}`);
      }
      if (!existente || existente.plano_contas_id !== planoId) {
        await api.post(`/integracoes-bancarias/${selectedIntegracaoId}/mapeamentos`, {
          categoria_externa: codigo,
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
    const existente = mapeamentos.find(m => m.categoria_externa === codigo);
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
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">Criar integração</h3>

        {contasAsaas.length === 0 && (
          <div className="p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-sm text-slate-500">
            Crie uma conta especial Asaas em Contas para habilitar a integração.
          </div>
        )}

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
            <p className="text-[11px] text-slate-400 mt-1">O token é enviado apenas na criação e nunca é retornado pelo backend.</p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta Asaas</label>
            {contasAsaas.length <= 1 ? (
              <div className="px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm">
                {contaSelecionada ? contaLabel(contaSelecionada) : 'Nenhuma conta Asaas disponível'}
              </div>
            ) : (
              <select
                className="w-full px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                value={formContaId}
                onChange={e => setFormContaId(e.target.value ? parseInt(e.target.value) : '')}
              >
                <option value="">Selecione...</option>
                {contasAsaas.map(conta => (
                  <option key={conta.id} value={conta.id}>{contaLabel(conta)}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <button
          onClick={handleCriarIntegracao}
          disabled={saving || contasAsaas.length === 0}
          className="px-5 py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          Criar integração
        </button>
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
              tiposAsaas.map(tipo => {
                const selected = mappingSelections[tipo.codigo] || '';
                const mapped = mapeamentos.find(m => m.categoria_externa === tipo.codigo);
                return (
                  <div key={tipo.codigo} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">{tipo.descricao}</div>
                      <div className="text-xs text-slate-400">{tipo.codigo}</div>
                    </div>
                    <div className="flex-1">
                      <select
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                        value={selected}
                        onChange={e => setMappingSelections(prev => ({ ...prev, [tipo.codigo]: e.target.value ? parseInt(e.target.value) : '' }))}
                      >
                        <option value="">Selecione categoria...</option>
                        {categorias.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.nome}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 flex items-center gap-1"
                        onClick={() => handleSalvarMapeamento(tipo.codigo)}
                      >
                        <Check className="w-3 h-3" />
                        Salvar
                      </button>
                      {mapped && (
                        <button
                          className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-200 flex items-center gap-1"
                          onClick={() => handleRemoverMapeamento(tipo.codigo)}
                        >
                          <X className="w-3 h-3" />
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
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
