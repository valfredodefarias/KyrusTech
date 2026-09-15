import React from 'react';
import { AlertCircle, ShieldAlert } from 'lucide-react';

interface AuditoriaAlerta {
  id?: number;
  tipo_anomalia?: string;
  mensagem?: string;
  descricao?: string;
  severidade?: 'INFO' | 'WARNING' | 'CRITICAL';
  gravidade?: string;
  sugestao?: string;
}

interface LancamentoAuditoriaSectionProps {
  isEditing: boolean;
  activeAlerts: AuditoriaAlerta[];
  inlineSilencing: boolean;
  onInlineSilencingChange: (value: boolean) => void;
}

export const LancamentoAuditoriaSection: React.FC<LancamentoAuditoriaSectionProps> = ({
  isEditing,
  activeAlerts,
  inlineSilencing,
  onInlineSilencingChange,
}) => {
  // Desduplicar alertas redundantes por tipo e descrição
  const uniqueAlerts = React.useMemo(() => {
    if (!activeAlerts || activeAlerts.length === 0) return [];
    const seen = new Set<string>();
    return activeAlerts.filter((a) => {
      const key = `${a.tipo_anomalia || ''}|${a.descricao || a.mensagem || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activeAlerts]);

  return (
    <div className="space-y-3">
      {/* Alertas Ativos de Auditoria */}
      {uniqueAlerts && uniqueAlerts.length > 0 && (
        <div className="space-y-2">
          {uniqueAlerts.map((alerta, idx) => (
            <div
              key={alerta.id || idx}
              className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl flex items-start gap-2.5"
            >
              <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-bold text-amber-800 dark:text-amber-200">
                  {alerta.tipo_anomalia === 'VALOR_ATIPICO'
                    ? 'Aviso de Valor Atípico'
                    : alerta.tipo_anomalia === 'DUPLICIDADE'
                    ? 'Possível Duplicidade Detectada'
                    : 'Alerta de Auditoria'}
                </p>
                <p className="text-amber-700 dark:text-amber-300 mt-0.5 leading-relaxed">
                  {alerta.descricao || alerta.mensagem || alerta.sugestao || 'Este lançamento possui características fora do padrão histórico.'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Opção de Silenciamento Inline */}
      {isEditing && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={inlineSilencing}
              onChange={(e) => onInlineSilencingChange(e.target.checked)}
              className="rounded border-slate-200 text-indigo-600 focus:ring-indigo-500 w-4 h-4"
            />
            <span className="flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-slate-400" />
              Ignorar alertas futuros similares
            </span>
          </label>
          {inlineSilencing && (
            <p className="text-[10px] text-slate-400 leading-relaxed pl-6 text-left">
              Ao marcar esta opção, o sistema criará automaticamente uma regra de silenciamento para a categoria selecionada e este favorecido, evitando alertas de desvio de valor.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
