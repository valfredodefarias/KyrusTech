import { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { ROUTE_RULES } from '../utils/routeRegistry';

export interface KyrusLoadingScreenProps {
  /** Mensagem principal customizada (opcional; se omitida, detecta o nome do módulo dinamicamente) */
  message?: string;
  /** Submensagem ou dica de status (opcional; se omitida, rotaciona micro-status corporativos) */
  submessage?: string;
  /** Se true, ocupa a tela inteira com backdrop blur (ideal para inicialização do app/login) */
  fullScreen?: boolean;
  /** Caminho de rota de destino (opcional, útil quando em abas com customLocation) */
  targetPath?: string;
}

const DEFAULT_SUBMESSAGES = [
  'Sincronizando dados corporativos...',
  'Preparando ambiente de trabalho...',
  'Otimizando componentes da interface...',
  'Conexão segura com o servidor...',
  'Carregando preferências do sistema...'
];

export function KyrusLoadingScreen({
  message,
  submessage,
  fullScreen = false,
  targetPath
}: KyrusLoadingScreenProps) {
  const location = useLocation();
  const [submessageIndex, setSubmessageIndex] = useState(0);
  const [isFading, setIsFading] = useState(false);

  // Rota ativa para determinar o título dinâmico do módulo
  const activePath = useMemo(() => {
    const raw = targetPath || location.pathname || '';
    return raw.split('?')[0];
  }, [targetPath, location.pathname]);

  // Título dinâmico baseado na rota
  const computedTitle = useMemo(() => {
    if (message) return message;

    if (activePath === '/' || activePath === '/login') {
      return 'Inicializando KyrusERP...';
    }

    const rule = ROUTE_RULES[activePath];
    if (rule?.defaultLabel) {
      return `Carregando ${rule.defaultLabel}...`;
    }

    // Prefixo matching para subrotas como /pdv/fechamento, /apps/ifood, etc.
    const matchingKey = Object.keys(ROUTE_RULES).find((key) => 
      key !== '/home' && activePath.startsWith(key)
    );
    if (matchingKey && ROUTE_RULES[matchingKey]?.defaultLabel) {
      return `Carregando ${ROUTE_RULES[matchingKey].defaultLabel}...`;
    }

    return 'Carregando módulo...';
  }, [message, activePath]);

  // Rotação suave das mensagens secundárias a cada 2.5s se submessage não for fixa
  useEffect(() => {
    if (submessage) return;

    const interval = setInterval(() => {
      setIsFading(true);
      setTimeout(() => {
        setSubmessageIndex((prev) => (prev + 1) % DEFAULT_SUBMESSAGES.length);
        setIsFading(false);
      }, 200);
    }, 2500);

    return () => clearInterval(interval);
  }, [submessage]);

  const activeSubmessage = submessage || DEFAULT_SUBMESSAGES[submessageIndex];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center select-none transition-all duration-300 ${
        fullScreen
          ? 'fixed inset-0 z-50 bg-slate-50/90 dark:bg-[#090d16]/95 backdrop-blur-md px-6'
          : 'min-h-[45vh] flex-1 py-12 px-6 w-full'
      }`}
    >
      <style>{`
        @keyframes kyrusLoadingShimmer {
          0% { transform: translateX(-120%); width: 35%; }
          50% { transform: translateX(40%); width: 60%; }
          100% { transform: translateX(220%); width: 35%; }
        }
        @keyframes kyrusPulseGlow {
          0%, 100% { opacity: 0.35; transform: scale(1); }
          50% { opacity: 0.65; transform: scale(1.06); }
        }
      `}</style>

      {/* Container Central com Card Glassmórfico */}
      <div className="relative flex flex-col items-center max-w-sm w-full text-center">
        
        {/* Glow de fundo ambiental */}
        <div 
          className="absolute -top-12 w-44 h-44 rounded-full bg-blue-500/10 dark:bg-blue-600/15 blur-2xl pointer-events-none"
          style={{ animation: 'kyrusPulseGlow 4s ease-in-out infinite' }}
        />

        {/* Círculos Concêntricos de Carregamento Fluido */}
        <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex items-center justify-center mb-6">
          {/* Glow radial de fundo */}
          <div className="absolute inset-0 rounded-full bg-blue-500/15 dark:bg-blue-500/25 blur-xl animate-pulse" />

          {/* Anel Externo - Rotação Horária Suave */}
          <div className="absolute inset-0 rounded-full border-[2.5px] border-slate-200/60 dark:border-slate-800/80" />
          <div className="absolute inset-0 rounded-full border-[2.5px] border-transparent border-t-blue-600 border-r-indigo-500 dark:border-t-blue-400 dark:border-r-indigo-400 animate-spin [animation-duration:1.5s]" />

          {/* Anel Intermediário - Contra-Rotação Anti-Horária */}
          <div className="absolute inset-2.5 sm:inset-3 rounded-full border-2 border-slate-200/40 dark:border-slate-800/50" />
          <div className="absolute inset-2.5 sm:inset-3 rounded-full border-2 border-transparent border-b-cyan-500 border-l-blue-500 dark:border-b-cyan-400 dark:border-l-blue-400 animate-spin [animation-duration:2.2s] [animation-direction:reverse]" />

          {/* Anel Interno - Giro Rápido de Precisão */}
          <div className="absolute inset-5 sm:inset-6 rounded-full border-2 border-transparent border-t-indigo-500 border-r-blue-400 dark:border-t-indigo-300 dark:border-r-blue-300 animate-spin [animation-duration:0.9s]" />

          {/* Ponto Central de Pulso */}
          <div className="relative w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-500 to-cyan-400 shadow-md shadow-blue-500/50 animate-pulse" />
        </div>

        {/* Marca KyrusTECH */}
        <div className="flex items-center justify-center mb-1.5">
          <span className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
            Kyrus<span className="text-blue-600 dark:text-blue-400">TECH</span>
          </span>
        </div>

        {/* Título Dinâmico do Módulo */}
        <h2 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-200 tracking-tight">
          {computedTitle}
        </h2>

        {/* Submensagem rotativa com transição fade suave */}
        <p className={`text-xs text-slate-500 dark:text-slate-400 mt-1 min-h-[18px] transition-opacity duration-200 ${
          isFading ? 'opacity-0' : 'opacity-100'
        }`}>
          {activeSubmessage}
        </p>

        {/* Barra de Progresso Indeterminada de Alta Precisão */}
        <div className="w-48 sm:w-56 h-1.5 mt-4 bg-slate-200/70 dark:bg-slate-800/80 rounded-full overflow-hidden relative shadow-inner">
          <div 
            className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 dark:from-blue-400 dark:via-indigo-400 dark:to-cyan-300"
            style={{
              animation: 'kyrusLoadingShimmer 1.8s ease-in-out infinite'
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default KyrusLoadingScreen;
