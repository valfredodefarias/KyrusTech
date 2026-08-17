import { useIntegracoesWebSocket } from '../hooks/useConfiguracoesWebSocket';
import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useIntegracoes } from '../hooks/useIntegracoes';
import { SearchableSelect } from '../../../components/SearchableSelect';

export const TabIntegracoes = () => {
  const {
    centros, integracoes, loading, saving, forcingSync,
    centroCustoId, setCentroCustoId, nome, setNome, username, setUsername, password, setPassword,
    selectCompany, setSelectCompany, companyName, setCompanyName, ativo, setAtivo,
    forceSyncLogin, setForceSyncLogin, canForceSyncByLogin,
    handleSave, handleSyncNow, handleSyncByLogin
  , loadData } = useIntegracoes();
  useIntegracoesWebSocket(loadData);

  return (
    <div className="w-full animate-in fade-in slide-in-from-bottom-4">
      <div className="rounded-none border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-6">
        <h2 className="text-2xl font-black text-slate-900 dark:text-white">NFStock por Centro de Custo</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Configura usuário/senha por centro de custo. O sistema sincroniza diariamente às 1:00 AM e importa NF-e novas com XML+PDF.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Centro de custo</span>
            <SearchableSelect
              value={centroCustoId}
              onChange={(val) => setCentroCustoId(String(val))}
              options={[{
                label: 'Centro de custo',
                options: [
                  { id: '', label: 'Selecione' },
                  ...centros.map((centro) => ({ id: String(centro.id), label: centro.nome }))
                ]
              }]}
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Nome da integração</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>

          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Usuário NFStock</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>

          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Senha NFStock</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>

          <label className="flex items-center gap-2 pt-6 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={selectCompany} onChange={(e) => setSelectCompany(e.target.checked)} />
            Selecionar empresa após login
          </label>

          <label>
            <span className="mb-1 block text-xs font-bold uppercase text-slate-500">Empresa no NFStock</span>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={!selectCompany} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
          </label>

          <label className="flex items-center gap-2 pt-6 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Integração ativa
          </label>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={handleSave} disabled={saving || loading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-60">
            {saving ? 'Salvando...' : 'Salvar integração NFStock'}
          </button>
        </div>

        {canForceSyncByLogin ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">Ação restrita</p>
            <h3 className="mt-1 text-sm font-black text-slate-900 dark:text-white">Buscar NF-e por login específico</h3>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Use somente quando precisar forçar a busca de notas para um usuário NFStock específico.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={forceSyncLogin}
                onChange={(e) => setForceSyncLogin(e.target.value)}
                placeholder="Login NFStock"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => void handleSyncByLogin()}
                disabled={forcingSync || loading}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {forcingSync ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {forcingSync ? 'Buscando notas...' : 'Buscar notas por login'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900/50">
              <tr>
                <th className="px-3 py-2">Centro de custo</th>
                <th className="px-3 py-2">Usuário</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {integracoes.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nenhuma integração NFStock configurada.</td></tr>
              ) : integracoes.map((item) => {
                const centro = centros.find((c) => Number(c.id) === Number(item.centro_custo_id));
                return (
                  <tr key={item.id} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2">{centro?.nome || `ID ${item.centro_custo_id ?? '-'}`}</td>
                    <td className="px-3 py-2">{item.nfstock_username || '-'}</td>
                    <td className="px-3 py-2">{item.ativo ? 'ATIVO' : 'INATIVO'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => void handleSyncNow(item.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                        Sincronizar agora
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};


