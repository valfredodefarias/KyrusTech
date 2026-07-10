import { ArrowRightLeft, CheckCircle2 } from 'lucide-react';
import { BankAvatar } from '../../../components/BrandAvatar';
import { toPublicAssetUrl } from '../../../services/api';
import { InputDark, CurrencyInputDark } from './InputDark';

interface TransferModalProps {
  showTransfer: boolean;
  setShowTransfer: (show: boolean) => void;
  transferData: {
    valor: string;
    data: string;
    conta_origem_id: string;
    conta_destino_id: string;
    observacao: string;
    centro_custo_id: string;
  };
  setTransferData: React.Dispatch<React.SetStateAction<any>>;
  contas: any[];
  centros: any[];
  handleTransferencia: () => void;
  saving: boolean;
}

export const TransferModal = ({
  showTransfer,
  setShowTransfer,
  transferData,
  setTransferData,
  contas,
  centros,
  handleTransferencia,
  saving,
}: TransferModalProps) => {
  if (!showTransfer) return null;

  const contasAtivas = contas.filter(
    (conta) => String(conta?.status || 'ATIVO').toUpperCase() === 'ATIVO'
  );

  const getFullLogoUrl = (url?: string | null) => toPublicAssetUrl(url);

  const getTransferContaLabel = (conta: any) => conta?.banco || conta?.nome || 'Conta bancária';

  const renderTransferContaButton = (conta: any, role: 'origem' | 'destino') => {
    const selectedId = role === 'origem' ? transferData.conta_origem_id : transferData.conta_destino_id;
    const isSelected = String(selectedId) === String(conta.id);
    const isBlocked =
      role === 'origem'
        ? String(transferData.conta_destino_id) === String(conta.id)
        : String(transferData.conta_origem_id) === String(conta.id);
    const logo = getFullLogoUrl(conta.logo_url);

    return (
      <button
        key={`${role}-${conta.id}`}
        type="button"
        disabled={isBlocked}
        onClick={() =>
          setTransferData((prev: any) => ({
            ...prev,
            [role === 'origem' ? 'conta_origem_id' : 'conta_destino_id']: String(conta.id),
          }))
        }
        className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
          isSelected
            ? 'border-blue-500 bg-blue-50 shadow-sm dark:border-blue-400 dark:bg-blue-500/10'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500 dark:hover:bg-slate-800'
        } ${isBlocked ? 'cursor-not-allowed opacity-45' : ''}`}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <BankAvatar
            logoUrl={logo}
            bankName={conta.banco}
            accountName={conta.nome}
            integrationType={conta.tipo_integracao}
            size="sm"
            className="h-11 w-11"
            imageClassName="rounded-2xl"
            fallbackClassName="rounded-2xl border-0 shadow-none"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-100">{getTransferContaLabel(conta)}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{conta.nome || conta.tipo || 'Conta bancária'}</p>
        </div>
        {isSelected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-500" /> : null}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowTransfer(false)}></div>
      <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-slate-200 dark:border-slate-700 animate-scale-in">
        <h3 className="font-bold text-lg mb-4 text-slate-800 dark:text-white flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-blue-500" /> Nova Transferência
        </h3>
        <div className="space-y-4">
          <CurrencyInputDark
            label="Valor (R$)"
            value={transferData.valor}
            onValueChange={(value: string) => setTransferData((prev: any) => ({ ...prev, valor: value }))}
          />
          <InputDark
            label="Data"
            type="date"
            value={transferData.data}
            onChange={(e: any) => setTransferData((prev: any) => ({ ...prev, data: e.target.value }))}
          />

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-400 uppercase">Origem</label>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {contasAtivas.map((conta) => renderTransferContaButton(conta, 'origem'))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold text-slate-400 uppercase">Destino</label>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {contasAtivas.map((conta) => renderTransferContaButton(conta, 'destino'))}
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-1">Centro de Custo</label>
            <select
              className="w-full p-2 rounded bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-white text-sm"
              value={transferData.centro_custo_id}
              onChange={(e) => setTransferData((prev: any) => ({ ...prev, centro_custo_id: e.target.value }))}
            >
              <option value="">Opcional</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </div>

          <InputDark
            label="Observação"
            value={transferData.observacao}
            onChange={(e: any) => setTransferData((prev: any) => ({ ...prev, observacao: e.target.value }))}
          />
        </div>
        <div className="flex gap-2 mt-6">
          <button
            onClick={() => setShowTransfer(false)}
            className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleTransferencia}
            disabled={saving}
            className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-500 shadow-lg transition"
          >
            {saving ? 'Enviando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
};
