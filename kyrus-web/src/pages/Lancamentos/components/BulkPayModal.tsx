interface BulkPayData {
  conta_id: string;
  modoData: string;
  data: string;
}

interface BulkPayModalProps {
  showBulkPay: boolean;
  setShowBulkPay: (show: boolean) => void;
  bulkPayData: BulkPayData;
  setBulkPayData: React.Dispatch<React.SetStateAction<BulkPayData>>;
  contas: any[];
  handleBulkPay: () => void;
  saving: boolean;
}

export const BulkPayModal = ({
  showBulkPay,
  setShowBulkPay,
  bulkPayData,
  setBulkPayData,
  contas,
  handleBulkPay,
  saving,
}: BulkPayModalProps) => {
  if (!showBulkPay) return null;

  const contasAtivas = contas.filter(
    (conta) => String(conta?.status || 'ATIVO').toUpperCase() === 'ATIVO'
  );

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm" onClick={() => setShowBulkPay(false)}></div>
      <div className="relative bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-700">
        <h3 className="font-bold text-lg mb-4 text-white">Baixar selecionados</h3>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2">Conta de pagamento</p>
            <select
              className="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-white outline-none"
              value={bulkPayData.conta_id}
              onChange={(e) => setBulkPayData((prev) => ({ ...prev, conta_id: e.target.value }))}
            >
              <option value="">Selecionar...</option>
              {contasAtivas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2">Data de pagamento</p>
            <div className="flex flex-col gap-2 text-sm text-white">
              {[
                { id: 'HOJE', label: 'Hoje' },
                { id: 'ONTEM', label: 'Ontem' },
                { id: 'OUTRO', label: 'Outro dia' },
              ].map((opt) => (
                <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bulk-date"
                    checked={bulkPayData.modoData === opt.id}
                    onChange={() => setBulkPayData((prev) => ({ ...prev, modoData: opt.id }))}
                    className="accent-blue-500"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
              {bulkPayData.modoData === 'OUTRO' && (
                <input
                  type="date"
                  className="mt-1 p-2 rounded border border-slate-600 bg-slate-900 text-white outline-none"
                  value={bulkPayData.data}
                  onChange={(e) => setBulkPayData((prev) => ({ ...prev, data: e.target.value }))}
                />
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-6">
          <button
            onClick={() => setShowBulkPay(false)}
            className="flex-1 py-3 text-slate-400 font-bold hover:bg-slate-700 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleBulkPay}
            disabled={saving}
            className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 shadow-lg transition disabled:opacity-50"
          >
            {saving ? 'Enviando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};
