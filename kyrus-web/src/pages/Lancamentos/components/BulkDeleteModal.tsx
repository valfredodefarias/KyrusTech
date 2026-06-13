import { Trash2 } from 'lucide-react';

interface BulkDeleteModalProps {
  showBulkDelete: boolean;
  setShowBulkDelete: (show: boolean) => void;
  selectedIds: Set<number>;
  hasSelectedCompensados: boolean;
  selectedCompensadosCount: number;
  deleteStep: number;
  setDeleteStep: React.Dispatch<React.SetStateAction<number>>;
  deleteReason: string;
  setDeleteReason: (reason: string) => void;
  deletePhrase: string;
  setDeletePhrase: (phrase: string) => void;
  deletePaidPhrase: string;
  setDeletePaidPhrase: (phrase: string) => void;
  handleBulkDelete: () => void;
  saving: boolean;
}

export const BulkDeleteModal = ({
  showBulkDelete,
  setShowBulkDelete,
  selectedIds,
  hasSelectedCompensados,
  selectedCompensadosCount,
  deleteStep,
  setDeleteStep,
  deleteReason,
  setDeleteReason,
  deletePhrase,
  setDeletePhrase,
  deletePaidPhrase,
  setDeletePaidPhrase,
  handleBulkDelete,
  saving,
}: BulkDeleteModalProps) => {
  if (!showBulkDelete) return null;

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setShowBulkDelete(false)}></div>
      <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-700 animate-scale-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg text-white flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-400" /> Apagar selecionados
          </h3>
          <div className="text-[11px] text-slate-400">Etapa {deleteStep} de 3</div>
        </div>

        {deleteStep === 1 && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-200 text-sm">
              Você está prestes a apagar <strong>{selectedIds.size}</strong> lançamento(s). Esta ação é irreversível.
            </div>
            {hasSelectedCompensados && (
              <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700 text-amber-200 text-sm">
                Atenção: <strong>{selectedCompensadosCount}</strong> lançamento(s) pago(s)/compensado(s) foram selecionados e exigem confirmação adicional.
              </div>
            )}
            <div className="text-xs text-slate-400">Confirme que deseja continuar.</div>
          </div>
        )}

        {deleteStep === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Motivo</label>
              <select
                className="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-white outline-none"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              >
                <option value="">Selecionar...</option>
                <option value="DUPLICADO">Duplicado</option>
                <option value="LANCAMENTO_INCORRETO">Lançamento incorreto</option>
                <option value="CANCELADO">Cancelado</option>
                <option value="OUTRO">Outro</option>
              </select>
            </div>
            <div className="text-xs text-slate-400">Selecione um motivo para prosseguir.</div>
          </div>
        )}

        {deleteStep === 3 && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-red-900/20 border border-red-800 text-red-200 text-sm">
              Digite <strong>APAGAR</strong> para confirmar a exclusão.
            </div>
            <input
              type="text"
              value={deletePhrase}
              onChange={(e) => setDeletePhrase(e.target.value)}
              placeholder="Digite APAGAR"
              className="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-white outline-none"
            />
            {hasSelectedCompensados && (
              <>
                <div className="p-3 rounded-lg bg-amber-900/20 border border-amber-700 text-amber-200 text-sm">
                  Para excluir itens pagos/compensados, digite <strong>EXCLUIR PAGOS</strong>.
                </div>
                <input
                  type="text"
                  value={deletePaidPhrase}
                  onChange={(e) => setDeletePaidPhrase(e.target.value)}
                  placeholder="Digite EXCLUIR PAGOS"
                  className="w-full p-3 rounded-lg border border-amber-600 bg-slate-900 text-white outline-none"
                />
              </>
            )}
            <div className="text-xs text-slate-400">Motivo: {deleteReason || '—'}</div>
          </div>
        )}

        <div className="flex gap-2 mt-6">
          <button
            onClick={() => setShowBulkDelete(false)}
            className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-700 rounded-lg transition"
          >
            Cancelar
          </button>
          {deleteStep > 1 && (
            <button
              onClick={() => setDeleteStep((prev) => Math.max(1, prev - 1))}
              className="flex-1 py-3 bg-slate-700 text-white font-bold rounded-lg hover:bg-slate-600 transition"
            >
              Voltar
            </button>
          )}
          {deleteStep < 3 && (
            <button
              onClick={() => setDeleteStep((prev) => Math.min(3, prev + 1))}
              disabled={deleteStep === 2 && !deleteReason}
              className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 shadow-lg transition disabled:opacity-50"
            >
              Continuar
            </button>
          )}
          {deleteStep === 3 && (
            <button
              onClick={handleBulkDelete}
              disabled={
                deletePhrase.trim() !== 'APAGAR' ||
                (hasSelectedCompensados && deletePaidPhrase.trim().toUpperCase() !== 'EXCLUIR PAGOS') ||
                saving
              }
              className="flex-1 py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-500 shadow-lg transition disabled:opacity-50"
            >
              {saving ? 'Apagando...' : 'Apagar agora'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
