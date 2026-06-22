import { useState, useEffect } from 'react';
import { useComissoesDashboard } from '../hooks/useComissoesDashboard';
import { 
  RefreshCw, AlertCircle, Award, 
  ChevronDown, ChevronUp, Target, Sparkles
} from 'lucide-react';

const formatBRL = (val: number, forceDecimals = false) => {
  if (val === undefined || val === null) return '0';
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: forceDecimals ? 2 : 0,
    maximumFractionDigits: forceDecimals ? 2 : 0
  }).format(val);
};

interface GaugeProps {
  value: number;
  label: string;
}

function Gauge({ value, label }: GaugeProps) {
  const cappedValue = Math.min(120, Math.max(0, value));
  // Needle rotation: 0% is -140deg, 120% is +140deg (span of 280deg)
  const needleAngle = (cappedValue / 120) * 280 - 140;

  const getCoordinate = (angle: number, radius: number) => {
    const angleRad = ((angle - 90) * Math.PI) / 180;
    return {
      x: 100 + radius * Math.cos(angleRad),
      y: 100 + radius * Math.sin(angleRad),
    };
  };

  const describeArc = (startAngle: number, endAngle: number, radius: number) => {
    const start = getCoordinate(startAngle, radius);
    const end = getCoordinate(endAngle, radius);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 1, end.x, end.y
    ].join(" ");
  };

  // Draw 13 ticks (every 10%)
  const ticks = [];
  for (let i = 0; i <= 12; i++) {
    const angle = 220 + i * (280 / 12);
    const outer = getCoordinate(angle, 73);
    const inner = getCoordinate(angle, 66);
    ticks.push(
      <line
        key={i}
        x1={outer.x}
        y1={outer.y}
        x2={inner.x}
        y2={inner.y}
        stroke="#4b5563"
        strokeWidth="1.5"
      />
    );
  }

  // Neon active color based on gauge label and value
  const getGlowColor = () => {
    if (value >= 110) return 'rgba(16, 185, 129, 0.4)'; // Emerald
    if (value >= 100) return 'rgba(245, 158, 11, 0.4)'; // Yellow/Amber
    return 'rgba(239, 68, 68, 0.4)'; // Red
  };

  return (
    <div className="flex flex-col items-center select-none w-full max-w-[280px]">
      <div className="relative w-full aspect-square filter drop-shadow-[0_0_12px_var(--gauge-glow)]" style={{ '--gauge-glow': getGlowColor() } as any}>
        <svg viewBox="0 0 200 200" className="w-full h-full">
          <defs>
            <filter id="glow-neon" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Dark Glass Disc (Cyberpunk style) */}
          <circle cx="100" cy="100" r="77" fill="#0f0f13" />

          {/* Outer Metallic Ring */}
          <circle cx="100" cy="100" r="79" fill="none" stroke="#d97706" strokeWidth="2.5" className="opacity-40" />
          <circle cx="100" cy="100" r="77" fill="none" stroke="#1f2937" strokeWidth="1" />

          {/* Track Arc Background */}
          <path
            d={describeArc(220, 500, 70)}
            fill="none"
            stroke="#1f2937"
            strokeWidth="10"
            strokeLinecap="round"
            className="opacity-50"
          />

          {/* Red Zone (0% to 100%) */}
          <path
            d={describeArc(220, 453.3, 70)}
            fill="none"
            stroke="#ef4444"
            strokeWidth="10"
            filter="url(#glow-neon)"
          />

          {/* Yellow/Orange Zone (100% to 110%) */}
          <path
            d={describeArc(453.3, 476.7, 70)}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="10"
            filter="url(#glow-neon)"
          />

          {/* Green Zone (110% to 120%) */}
          <path
            d={describeArc(476.7, 500, 70)}
            fill="none"
            stroke="#10b981"
            strokeWidth="10"
            strokeLinecap="round"
            filter="url(#glow-neon)"
          />

          {/* Ticks */}
          {ticks}

          {/* Scale labels */}
          <text x="44" y="160" fill="#6b7280" fontSize="9" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">0</text>
          <text x="156" y="160" fill="#6b7280" fontSize="9" textAnchor="middle" fontWeight="bold" fontFamily="sans-serif">1.2</text>

          {/* Percentage text */}
          <text
            x="100"
            y="142"
            fill="#ffffff"
            fontSize="26"
            textAnchor="middle"
            fontWeight="black"
            fontFamily="sans-serif"
            className="font-mono tracking-tighter"
          >
            {Math.round(value || 0)}%
          </text>

          {/* Needle */}
          <polygon
            points="96.5,100 103.5,100 100,24"
            fill="#ea580c"
            className="transition-transform duration-1000 ease-out"
            filter="url(#glow-neon)"
            style={{
              transformOrigin: '100px 100px',
              transform: `rotate(${needleAngle}deg)`,
            }}
          />

          {/* Center Blue Cap */}
          <circle cx="100" cy="100" r="9" fill="#3b82f6" stroke="#1d4ed8" strokeWidth="2.5" filter="url(#glow-neon)" />
        </svg>
      </div>
      <div className="text-base font-bold tracking-widest text-slate-300 uppercase mt-2">
        {label}
      </div>
    </div>
  );
}

export function ComissoesDashboard() {
  const defaultYear = 2026;
  const defaultMonth = 6;

  const [mes, setMes] = useState(defaultMonth);
  const [ano, setAno] = useState(defaultYear);
  const [selectedVendedorId, setSelectedVendedorId] = useState<number>(0);
  const [showSprints, setShowSprints] = useState(false);

  const { data, loading, error, refetch } = useComissoesDashboard(mes, ano);

  // Sync selected seller if they disappear from the dataset
  useEffect(() => {
    if (data?.vendedores && data.vendedores.length > 0) {
      const exists = data.vendedores.some(v => v.vendedor_id === selectedVendedorId);
      if (!exists) {
        const hasLoja = data.vendedores.some(v => v.vendedor_id === 0);
        setSelectedVendedorId(hasLoja ? 0 : data.vendedores[0].vendedor_id);
      }
    }
  }, [data, selectedVendedorId]);

  const mesesMap = [
    { value: 1, label: 'Janeiro' },
    { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Março' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },
    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },
    { value: 12, label: 'Dezembro' }
  ];

  const anosList = [2024, 2025, 2026];

  const getDezena = (hojeStr: string) => {
    if (!hojeStr) return 'Dezena 03';
    const parts = hojeStr.split('-');
    if (parts.length < 3) return 'Dezena 03';
    const day = parseInt(parts[2], 10);
    if (day <= 10) return 'Dezena 01';
    if (day <= 20) return 'Dezena 02';
    return 'Dezena 03';
  };

  const getTierInfo = (atingimento: number) => {
    if (atingimento >= 110) {
      return { label: 'Lendário 💎', style: 'text-cyan-400 border-cyan-400/40 bg-cyan-950/20 shadow-[0_0_10px_rgba(34,211,238,0.2)]' };
    } else if (atingimento >= 100) {
      return { label: 'Ouro 🥇', style: 'text-yellow-400 border-yellow-400/40 bg-yellow-950/20 shadow-[0_0_10px_rgba(250,204,21,0.2)]' };
    } else if (atingimento >= 80) {
      return { label: 'Prata 🥈', style: 'text-slate-300 border-slate-300/40 bg-slate-800/20 shadow-[0_0_10px_rgba(203,213,225,0.1)]' };
    } else {
      return { label: 'Bronze 🥉', style: 'text-amber-600 border-amber-600/40 bg-amber-950/10' };
    }
  };

  const selectedVendedor = data?.vendedores.find(v => v.vendedor_id === selectedVendedorId) 
    || data?.vendedores[0] 
    || null;

  return (
    <div className="flex flex-col h-full bg-[#030303] min-h-screen text-white font-sans overflow-hidden">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* Header */}
      <header className="bg-black/80 backdrop-blur-md border-b border-amber-500/20 px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-10">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
            <Target className="w-6 h-6 text-amber-500 animate-pulse" />
            REVISOR <span className="text-yellow-500 font-extrabold">{data ? getDezena(data.hoje) : 'Dezena 03'}</span>
          </h2>
        </div>
        
        {/* Filtros */}
        <div className="flex items-center gap-4">
          <div className="relative flex items-center gap-1.5">
            <span className="text-xs text-amber-500/80 uppercase font-black tracking-wider">Mês:</span>
            <select
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
              className="pl-3 pr-8 py-1.5 rounded border border-amber-500/30 bg-black text-sm text-slate-200 outline-none cursor-pointer focus:ring-1 focus:ring-amber-500 hover:border-amber-500/60 transition"
            >
              {mesesMap.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="relative flex items-center gap-1.5">
            <span className="text-xs text-amber-500/80 uppercase font-black tracking-wider">Ano:</span>
            <select
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="pl-3 pr-8 py-1.5 rounded border border-amber-500/30 bg-black text-sm text-slate-200 outline-none cursor-pointer focus:ring-1 focus:ring-amber-500 hover:border-amber-500/60 transition"
            >
              {anosList.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => refetch()}
            className="p-2 text-slate-400 hover:text-amber-500 hover:bg-[#121212] border border-transparent hover:border-amber-500/20 rounded transition"
            title="Atualizar dados"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <div className="p-8 space-y-6 max-w-[1600px] mx-auto w-full flex-1 animate-fade-in">
        {/* Estados de Erro e Loading */}
        {loading ? (
          <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-dashed border-amber-500/20 bg-black/40">
            <div className="text-center space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-amber-500 mx-auto" />
              <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Carregando Arena de Metas...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-dashed border-rose-900/50 bg-rose-950/10 px-6">
            <div className="text-center space-y-3 max-w-md">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <h3 className="text-lg font-bold text-white">Falha na Arena de Conquistas</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{error}</p>
              <button 
                onClick={() => refetch()}
                className="mt-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm font-bold transition shadow-lg"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : !data || data.vendedores.length === 0 ? (
          <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-dashed border-amber-500/20 bg-black/40">
            <div className="text-center space-y-2">
              <Award className="w-8 h-8 text-slate-700 mx-auto" />
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Nenhum guerreiro de vendas registrado no período.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Layout Principal */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Bloco Esquerdo: Seletor e Gauges */}
              <div className="lg:col-span-3 border border-amber-500/30 rounded-xl p-6 bg-black/60 backdrop-blur-md flex flex-col justify-between min-h-[480px] shadow-[0_0_20px_rgba(217,119,6,0.02)] hover:border-amber-500/50 hover:shadow-[0_0_30px_rgba(217,119,6,0.08)] transition-all duration-300">
                {/* Dropdown Selector + Rank Tier */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-500 text-xs font-black uppercase tracking-widest">Nome:</span>
                    <select
                      value={selectedVendedorId}
                      onChange={(e) => setSelectedVendedorId(Number(e.target.value))}
                      className="bg-black text-amber-500 border-2 border-amber-500/50 rounded px-3 py-1.5 outline-none cursor-pointer font-black focus:ring-1 focus:ring-amber-500 text-sm hover:border-amber-500 transition"
                    >
                      {data.vendedores.map((v) => (
                        <option key={v.vendedor_id} value={v.vendedor_id} className="bg-neutral-900 text-white">
                          {v.vendedor} {v.vendedor_id > 0 ? `(${v.vendedor_id})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Medal/Rank display */}
                  {selectedVendedor && (
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-black tracking-wider uppercase ${getTierInfo(selectedVendedor.atingimento_pct).style}`}>
                      <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                      Rank: {getTierInfo(selectedVendedor.atingimento_pct).label}
                    </div>
                  )}
                </div>

                {/* Gauges */}
                {selectedVendedor && (
                  <div className="flex flex-col sm:flex-row items-center justify-around gap-6 flex-1">
                    <Gauge value={selectedVendedor.atingimento_pct} label="REALIZADO" />
                    <Gauge value={selectedVendedor.atingimento_proj_pct} label="PROJETADO" />
                  </div>
                )}
              </div>

              {/* Bloco Direito: Grade de 8 Cards de Métricas */}
              {selectedVendedor && (
                <div className="lg:col-span-2 border border-amber-500/30 rounded-xl p-6 bg-black/60 backdrop-blur-md flex flex-col justify-between min-h-[480px] shadow-[0_0_20px_rgba(217,119,6,0.02)] hover:border-amber-500/50 hover:shadow-[0_0_30px_rgba(217,119,6,0.08)] transition-all duration-300">
                  <div className="grid grid-cols-2 gap-4 h-full">
                    {/* Card 1: META PERÍODO */}
                    <div className="bg-[#0b0b0e] border border-amber-500/20 rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px] text-center hover:scale-[1.02] hover:border-amber-500/40 transition-all duration-200">
                      <span className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest mb-1.5">Meta Período</span>
                      <span className="text-2xl font-black font-mono tracking-tight text-white">
                        {formatBRL(selectedVendedor.meta_total)}
                      </span>
                    </div>

                    {/* Card 2: REALIZADO */}
                    <div className="bg-[#0b0b0e] border border-amber-500/20 rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px] text-center hover:scale-[1.02] hover:border-amber-500/40 transition-all duration-200">
                      <span className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest mb-1.5">Realizado</span>
                      <span className="text-2xl font-black font-mono tracking-tight text-white">
                        {formatBRL(selectedVendedor.realizado)}
                      </span>
                    </div>

                    {/* Card 3: META PARA HOJE (Destaque Amarelo Neon) */}
                    <div className="bg-gradient-to-br from-amber-400 to-yellow-300 border border-[#f59e0b] rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px] text-slate-900 text-center shadow-[0_0_15px_rgba(245,158,11,0.25)] hover:scale-[1.03] hover:shadow-[0_0_22px_rgba(245,158,11,0.4)] transition-all duration-250">
                      <span className="text-[9px] font-black text-[#5b21b6] uppercase tracking-widest mb-1.5">Meta para Hoje</span>
                      <span className="text-2xl font-extrabold font-mono tracking-tight">
                        {formatBRL(selectedVendedor.meta_para_hoje)}
                      </span>
                    </div>

                    {/* Card 4: PROJETADO */}
                    <div className="bg-[#0b0b0e] border border-amber-500/20 rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px] text-center hover:scale-[1.02] hover:border-amber-500/40 transition-all duration-200">
                      <span className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest mb-1.5">Projetado</span>
                      <span className="text-2xl font-black font-mono tracking-tight text-white">
                        {formatBRL(selectedVendedor.projecao)}
                      </span>
                    </div>

                    {/* Card 5: REALIZADO COMISSÃO */}
                    <div className="bg-[#0b0b0e] border border-amber-500/20 rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px] text-center hover:scale-[1.02] hover:border-amber-500/40 transition-all duration-200">
                      <span className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest mb-1.5">Realizado Comissão</span>
                      <span className="text-2xl font-black font-mono tracking-tight text-white">
                        {formatBRL(selectedVendedor.realizado_comissao)}
                      </span>
                    </div>

                    {/* Card 6: MÉDIA DIÁRIA VENDAS (Destaque Azul Neon) */}
                    <div className="bg-gradient-to-br from-sky-400 to-blue-500 border border-[#0284c7] rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px] text-slate-900 text-center shadow-[0_0_15px_rgba(56,189,248,0.25)] hover:scale-[1.03] hover:shadow-[0_0_22px_rgba(56,189,248,0.4)] transition-all duration-250">
                      <span className="text-[9px] font-black text-[#1e3a8a] uppercase tracking-widest mb-1.5">Média Diária Vendas</span>
                      <span className="text-2xl font-extrabold font-mono tracking-tight">
                        {formatBRL(selectedVendedor.media_atual, true)}
                      </span>
                    </div>

                    {/* Card 7: A REALIZAR P/ META */}
                    <div className="bg-[#0b0b0e] border border-amber-500/20 rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px] text-center hover:scale-[1.02] hover:border-amber-500/40 transition-all duration-200">
                      <span className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest mb-1.5">A Realizar p/ Meta</span>
                      <span className="text-2xl font-black font-mono tracking-tight text-white">
                        {formatBRL(selectedVendedor.a_realizar_para_meta)}
                      </span>
                    </div>

                    {/* Card 8: COMISSÃO */}
                    <div className="bg-[#0b0b0e] border border-amber-500/20 rounded-lg p-4 flex flex-col items-center justify-center min-h-[90px] text-center hover:scale-[1.02] hover:border-amber-500/40 transition-all duration-200">
                      <span className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest mb-1.5">Comissão</span>
                      <span className="text-2xl font-black font-mono tracking-tight text-white">
                        {formatBRL(selectedVendedor.comissao_acumulada, true)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Visual XP Progression Bar (Gamification Element) */}
            {selectedVendedor && (
              <div className="border border-amber-500/25 bg-[#08080a]/90 rounded-xl p-6 shadow-[0_0_20px_rgba(217,119,6,0.03)]">
                <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider mb-2">
                  <span className="flex items-center gap-1.5 text-amber-400">
                    <Award className="w-4 h-4 animate-bounce" />
                    Progresso de Nível (Atingimento da Meta)
                  </span>
                  <span className="text-amber-500">{selectedVendedor.atingimento_pct}% Concluído</span>
                </div>
                <div className="h-4.5 w-full bg-slate-950 rounded-full border border-amber-500/30 p-0.5 overflow-hidden">
                  <div 
                    style={{ width: `${Math.min(100, selectedVendedor.atingimento_pct)}%` }} 
                    className={`h-full rounded-full transition-all duration-1000 ease-out bg-gradient-to-r ${
                      selectedVendedor.atingimento_pct >= 100 
                        ? 'from-emerald-500 to-green-400 shadow-[0_0_10px_#10b981]' 
                        : selectedVendedor.atingimento_pct >= 80 
                        ? 'from-amber-500 to-yellow-400 shadow-[0_0_10px_#f59e0b]' 
                        : 'from-rose-600 to-orange-500 shadow-[0_0_10px_#e11d48]'
                    }`}
                  />
                </div>
              </div>
            )}

            {/* Detalhamento de Sprints Collapsible */}
            {selectedVendedor && selectedVendedor.sprints.length > 0 && (
              <div className="border border-amber-500/20 bg-black rounded-md overflow-hidden shadow-md mt-6">
                <button 
                  onClick={() => setShowSprints(!showSprints)}
                  className="flex w-full items-center justify-between px-6 py-4 text-xs font-semibold text-slate-400 hover:bg-[#121212] transition-colors duration-150"
                >
                  <span className="tracking-widest uppercase text-slate-300">Detalhamento de Dezenas (Sprints)</span>
                  {showSprints ? <ChevronUp className="w-4 h-4 text-amber-500" /> : <ChevronDown className="w-4 h-4 text-amber-500" />}
                </button>
                
                {showSprints && (
                  <div className="px-6 pb-6 pt-2 bg-black border-t border-amber-500/10 space-y-3">
                    <table className="w-full text-left text-xs text-slate-300 mt-2">
                      <thead>
                        <tr className="text-amber-500 font-bold border-b border-amber-500/20 uppercase tracking-wider">
                          <th className="pb-3">Sprint</th>
                          <th className="pb-3 text-right">Meta (Peso)</th>
                          <th className="pb-3 text-right">Realizado</th>
                          <th className="pb-3 text-right">Atingimento</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1f2937]/50">
                        {selectedVendedor.sprints.map((sprint, sIdx) => (
                          <tr key={sIdx} className="hover:bg-[#121212] transition-colors">
                            <td className="py-3 font-semibold">{sprint.nome}</td>
                            <td className="py-3 text-right font-mono">
                              {formatBRL(sprint.meta_sprint)} <span className="text-[10px] text-slate-500">({sprint.peso_pct}%)</span>
                            </td>
                            <td className="py-3 text-right font-mono font-bold text-white">
                              {formatBRL(sprint.realizado_sprint)}
                            </td>
                            <td className="py-3 text-right">
                              <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-black ${
                                sprint.atingimento_pct >= 100 
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' 
                                  : sprint.atingimento_pct >= 80 
                                  ? 'bg-amber-950 text-amber-300 border border-amber-500/30' 
                                  : 'bg-rose-950 text-rose-300 border border-rose-500/30'
                              }`}>
                                {sprint.atingimento_pct}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
