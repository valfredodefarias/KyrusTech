import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { UploadCloud, FileSpreadsheet, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

function normalizarDescricao(texto?: string | null) {
  if (!texto) return '';
  return texto
    .toString()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

interface ContaItem {
  id: number;
  nome: string;
  banco?: string;
}

interface LancamentoImportado {
  data: string;
  data_hora?: string | null;
  descricao: string;
  razao_social: string;
  cpf_cnpj: string;
  referencia?: string | null;
  valor: number;
  tipo: string;
  origem: string;
  linha_arquivo: number;
  import_hash?: string | null;
  lancamento_previsto_id?: number | null;
  lancamentos_atrasados_ids?: number[];
  duplicata_id?: number | null;
  plano_contas_id?: number | null;
  entidade_id?: number | null;
  era_previsto?: boolean;
}

interface CategoriaItem {
  id: number;
  nome: string;
  tipo?: string;
  codigo?: string | null;
}

interface EntidadeItem {
  id: number;
  nome: string;
}

interface LancamentoSugestao {
  plano_contas_id?: number | null;
  entidade_id?: number | null;
}

interface LancamentoEditado extends LancamentoImportado {
  lancamentos_atrasados_relacionados?: number[];
  relacionar_apenas_atrasados?: boolean;
  auto_preenchido?: boolean;
}

interface ProcessarArquivoResponse {
  lancamentos: LancamentoImportado[];
  total_processado: number;
  duplicatas_encontradas: number;
  lancamentos_previstos_encontrados: number;
  lancamentos_atrasados_encontrados: number;
}

export function ImportacaoOfx() {
  const [searchParams] = useSearchParams();
  const [contas, setContas] = useState<ContaItem[]>([]);
  const [contaId, setContaId] = useState<number | ''>('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resultado, setResultado] = useState<ProcessarArquivoResponse | null>(null);
  const [lancamentosEditados, setLancamentosEditados] = useState<LancamentoEditado[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [categorias, setCategorias] = useState<CategoriaItem[]>([]);
  const [entidades, setEntidades] = useState<EntidadeItem[]>([]);
  const [sugestoes, setSugestoes] = useState<Record<string, LancamentoSugestao>>({});

  useEffect(() => {
    const contaParam = searchParams.get('conta_id');
    if (contaParam && !Number.isNaN(Number(contaParam))) {
      setContaId(Number(contaParam));
    }
  }, [searchParams]);

  useEffect(() => {
    async function loadContas() {
      try {
        const { data } = await api.get<ContaItem[]>('/contas/?include_saldo=false');
        setContas(data || []);
      } catch (error) {
        console.error('Erro ao carregar contas', error);
      }
    }
    loadContas();
  }, []);

  useEffect(() => {
    async function loadLookup() {
      try {
        const [catsRes, entRes, lancRes] = await Promise.all([
          api.get<CategoriaItem[]>('/plano-contas/'),
          api.get<EntidadeItem[]>('/entidades/lookup'),
          api.get<any[]>('/lancamentos/?limit=5000'),
        ]);
        setCategorias(catsRes.data || []);
        setEntidades(entRes.data || []);

        const map: Record<string, LancamentoSugestao> = {};
        (lancRes.data || []).forEach((lanc) => {
          const desc = normalizarDescricao(lanc.descricao);
          if (!desc) return;
          const key = `${lanc.tipo || ''}|${desc}`;
          if (!map[key]) {
            map[key] = {
              plano_contas_id: lanc.plano_contas_id ?? null,
              entidade_id: lanc.entidade_id ?? null,
            };
          }
        });
        setSugestoes(map);
      } catch (error) {
        console.error('Erro ao carregar dados de apoio', error);
      }
    }

    loadLookup();
  }, []);

  const contaSelecionada = useMemo(
    () => contas.find((c) => c.id === contaId),
    [contaId, contas]
  );

  const handleUpload = async () => {
    if (!arquivo || !contaId) {
      setFeedback({ type: 'error', message: 'Selecione uma conta e um arquivo OFX.' });
      return;
    }
    setFeedback(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('arquivo', arquivo);
      const { data } = await api.post<ProcessarArquivoResponse>(
        `/importacao/ofx/upload?conta_id=${contaId}`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setResultado(data);
      setFeedback({ type: 'success', message: 'Arquivo OFX processado com sucesso.' });
    } catch (error: any) {
      setResultado(null);
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao processar arquivo.' });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmar = async () => {
    if (!resultado || !contaId) return;
    setConfirming(true);
    setFeedback(null);
    try {
      const payload = {
        lancamentos: lancamentosEditados,
        conta_id: contaId,
      };
      const { data } = await api.post('/importacao/confirmar-lancamentos', payload);
      setFeedback({
        type: 'success',
        message: `Importacao concluida. Criados: ${data?.lancamentos_criados || 0}, atualizados: ${data?.lancamentos_atualizados || 0}.`
      });
    } catch (error: any) {
      setFeedback({ type: 'error', message: error?.response?.data?.detail || 'Erro ao confirmar importacao.' });
    } finally {
      setConfirming(false);
    }
  };

  useEffect(() => {
    if (!resultado) {
      setLancamentosEditados([]);
      return;
    }

    const editados = resultado.lancamentos.map((lanc) => {
      const key = `${lanc.tipo || ''}|${normalizarDescricao(lanc.descricao)}`;
      const sugestao = sugestoes[key] || {};
      const plano_contas_id = lanc.plano_contas_id ?? sugestao.plano_contas_id ?? null;
      const entidade_id = lanc.entidade_id ?? sugestao.entidade_id ?? null;
      const auto_preenchido = (lanc.plano_contas_id == null && sugestao.plano_contas_id != null)
        || (lanc.entidade_id == null && sugestao.entidade_id != null);

      return {
        ...lanc,
        plano_contas_id,
        entidade_id,
        auto_preenchido,
        lancamentos_atrasados_relacionados: [],
        relacionar_apenas_atrasados: false,
      } as LancamentoEditado;
    });

    setLancamentosEditados(editados);
  }, [resultado, sugestoes]);

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100">
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <UploadCloud className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-xl font-bold">Importacao OFX</h1>
            <p className="text-xs text-slate-400">Importe extratos OFX de qualquer banco.</p>
          </div>
        </div>
      </header>

      <div className="flex-1 p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Conta</label>
              <select
                value={contaId}
                onChange={(e) => setContaId(e.target.value ? Number(e.target.value) : '')}
                className="w-full p-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-sm"
              >
                <option value="">Selecione uma conta</option>
                {contas.map((conta) => (
                  <option key={conta.id} value={conta.id}>
                    {conta.nome} {conta.banco ? `(${conta.banco})` : ''}
                  </option>
                ))}
              </select>
              {!contaSelecionada && (
                <p className="text-[11px] text-amber-500 mt-1">Escolha a conta que recebera os lancamentos.</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase text-slate-500 mb-1">Arquivo OFX</label>
              <input
                type="file"
                accept=".ofx,.qfx"
                onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                className="w-full text-sm"
              />
              <p className="text-[11px] text-slate-400 mt-1">Formatos: OFX ou QFX.</p>
            </div>

            <button
              onClick={handleUpload}
              disabled={loading || !contaId}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Processar arquivo
            </button>

            {feedback && (
              <div className={`text-sm font-bold flex items-center gap-2 ${feedback.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                {feedback.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                {feedback.message}
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h2 className="text-sm font-bold uppercase text-slate-500 mb-3">Resumo do processamento</h2>
            {resultado ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-400">Total processado</p>
                    <p className="font-bold">{resultado.total_processado}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-400">Duplicatas</p>
                    <p className="font-bold">{resultado.duplicatas_encontradas}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-400">Previstos</p>
                    <p className="font-bold">{resultado.lancamentos_previstos_encontrados}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <p className="text-xs text-slate-400">Atrasados</p>
                    <p className="font-bold">{resultado.lancamentos_atrasados_encontrados}</p>
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="p-2 text-left">Data</th>
                        <th className="p-2 text-left">Descricao</th>
                        <th className="p-2 text-right">Valor</th>
                        <th className="p-2 text-left">Tipo</th>
                        <th className="p-2 text-left">Categoria</th>
                        <th className="p-2 text-left">Entidade</th>
                        <th className="p-2 text-left">Atrasados</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {lancamentosEditados.slice(0, 50).map((lanc, idx) => (
                        <tr key={`${lanc.linha_arquivo}-${idx}`} className={lanc.auto_preenchido ? 'bg-emerald-50/40 dark:bg-emerald-900/10' : ''}>
                          <td className="p-2 text-xs text-slate-500">{lanc.data}</td>
                          <td className="p-2">{lanc.descricao}</td>
                          <td className="p-2 text-right font-mono">{Number(lanc.valor).toFixed(2)}</td>
                          <td className="p-2 text-xs text-slate-500">{lanc.tipo}</td>
                          <td className="p-2">
                            <select
                              value={lanc.plano_contas_id || ''}
                              onChange={(e) => {
                                const value = e.target.value ? Number(e.target.value) : null;
                                setLancamentosEditados((prev) => prev.map((item) =>
                                  item.linha_arquivo === lanc.linha_arquivo ? { ...item, plano_contas_id: value } : item
                                ));
                              }}
                              className="w-full p-1.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs"
                            >
                              <option value="">A Categorizar</option>
                              {categorias.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.codigo ? `${cat.codigo} - ${cat.nome}` : cat.nome}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <select
                              value={lanc.entidade_id || ''}
                              onChange={(e) => {
                                const value = e.target.value ? Number(e.target.value) : null;
                                setLancamentosEditados((prev) => prev.map((item) =>
                                  item.linha_arquivo === lanc.linha_arquivo ? { ...item, entidade_id: value } : item
                                ));
                              }}
                              className="w-full p-1.5 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs"
                            >
                              <option value="">Sem entidade</option>
                              {entidades.map((ent) => (
                                <option key={ent.id} value={ent.id}>
                                  {ent.nome}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2 text-xs">
                            {lanc.lancamentos_atrasados_ids && lanc.lancamentos_atrasados_ids.length > 0 ? (
                              <div className="space-y-1">
                                <label className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={(lanc.lancamentos_atrasados_relacionados || []).length > 0}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setLancamentosEditados((prev) => prev.map((item) =>
                                        item.linha_arquivo === lanc.linha_arquivo
                                          ? {
                                              ...item,
                                              lancamentos_atrasados_relacionados: checked ? (lanc.lancamentos_atrasados_ids || []) : [],
                                            }
                                          : item
                                      ));
                                    }}
                                  />
                                  Vincular ({lanc.lancamentos_atrasados_ids.length})
                                </label>
                                <label className="flex items-center gap-2 text-[11px] text-slate-400">
                                  <input
                                    type="checkbox"
                                    checked={!!lanc.relacionar_apenas_atrasados}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      setLancamentosEditados((prev) => prev.map((item) =>
                                        item.linha_arquivo === lanc.linha_arquivo
                                          ? { ...item, relacionar_apenas_atrasados: checked }
                                          : item
                                      ));
                                    }}
                                  />
                                  Nao criar novo
                                </label>
                              </div>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {lancamentosEditados.length === 0 && (
                        <tr><td colSpan={7} className="p-4 text-center text-slate-400">Nenhum lancamento valido.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <button
                  onClick={handleConfirmar}
                  disabled={confirming || resultado.lancamentos.length === 0}
                  className="w-full py-2.5 rounded-lg bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Confirmar importacao
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-400">Nenhum arquivo processado ainda.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
