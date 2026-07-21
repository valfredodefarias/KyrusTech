import { useState, useEffect, useMemo } from 'react';
import { useComissoesDashboard } from '../hooks/useComissoesDashboard';
import { useAuthStore } from '../store/authStore';
import { 
  RefreshCw, AlertCircle, Award, 
  ChevronDown, ChevronUp, Target, Sparkles, UserCheck, Users, Share2, DollarSign
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
  // Needle rotation: 0% is -130deg, 120% is +130deg (span of 260deg)
  const needleAngle = (cappedValue / 120) * 260 - 130;

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

  const isTargetMet = value >= 100;
  const isSuperMet = value >= 110;
  const gaugeColor = isSuperMet ? '#10b981' : (isTargetMet ? '#f59e0b' : '#ef4444');

  return (
    <div className="flex flex-col items-center select-none w-full max-w-[260px] p-2">
      <div className="relative w-full aspect-square flex items-center justify-center">
        <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-[0_0_15px_rgba(245,158,11,0.15)]">
          <defs>
            <linearGradient id="arcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="70%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Dial Background Disc */}
          <circle cx="100" cy="100" r="78" fill="#09090b" stroke="#1f2937" strokeWidth="2" />

          {/* Background Track Arc */}
          <path
            d={describeArc(230, 490, 68)}
            fill="none"
            stroke="#27272a"
            strokeWidth="12"
            strokeLinecap="round"
          />

          {/* Active Gradient Filled Arc */}
          <path
            d={describeArc(230, 230 + (cappedValue / 120) * 260, 68)}
            fill="none"
            stroke="url(#arcGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            filter="url(#neonGlow)"
          />

          {/* Ticks (every 10%) */}
          {Array.from({ length: 13 }).map((_, i) => {
            const angle = 230 + i * (260 / 12);
            const p1 = getCoordinate(angle, 75);
            const p2 = getCoordinate(angle, 61);
            return (
              <line
                key={i}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={i === 0 || i === 10 || i === 12 ? '#d97706' : '#52525b'}
                strokeWidth={i % 5 === 0 ? '2' : '1'}
              />
            );
          })}

          {/* Scale Labels */}
          <text x="40" y="162" fill="#9ca3af" fontSize="10" textAnchor="middle" fontWeight="bold">0%</text>
          <text x="100" y="38" fill="#f59e0b" fontSize="9" textAnchor="middle" fontWeight="bold">100%</text>
          <text x="160" y="162" fill="#10b981" fontSize="10" textAnchor="middle" fontWeight="bold">120%</text>

          {/* Center Value Text */}
          <text
            x="100"
            y="135"
            fill={gaugeColor}
            fontSize="30"
            textAnchor="middle"
            fontWeight="900"
            className="font-mono tracking-tighter"
            filter="url(#neonGlow)"
          >
            {Math.round(value || 0)}%
          </text>

          {/* Needle */}
          <g
            className="transition-transform duration-1000 ease-out"
            style={{
              transformOrigin: '100px 100px',
              transform: `rotate(${needleAngle}deg)`,
            }}
          >
            <polygon points="98,100 102,100 100,28" fill="#f59e0b" filter="url(#neonGlow)" />
            <circle cx="100" cy="100" r="8" fill="#18181b" stroke="#f59e0b" strokeWidth="3" />
          </g>
        </svg>
      </div>
      <span className="text-xs font-black tracking-widest text-amber-500 uppercase mt-1">
        {label}
      </span>
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
  const [activeTab, setActiveTab] = useState<'INTERNOS' | 'EXTERNOS'>('INTERNOS');

  const { data, loading, error, refetch } = useComissoesDashboard(mes, ano);

  const user = useAuthStore((state) => state.user);

  const isAdminOrConsultor = useMemo(() => {
    if (!user) return false;
    return Boolean(
      user.is_consultor ||
      user.permissions?.includes('*') ||
      user.permissions?.includes('PDV_VER_TODAS_VENDAS')
    );
  }, [user]);

  // Filter sellers for non-admin/consultor users (Vendedores see only themselves)
  const availableVendedores = useMemo(() => {
    if (!data?.vendedores || data.vendedores.length === 0) return [];
    if (isAdminOrConsultor) return data.vendedores;

    const myId = user?.id;
    const filtered = data.vendedores.filter((v) => {
      if (v.vendedor_id === myId) return true;
      if (user?.nome && v.vendedor && v.vendedor.toLowerCase().includes(user.nome.toLowerCase())) return true;
      return false;
    });

    return filtered.length > 0 ? filtered : data.vendedores;
  }, [data, isAdminOrConsultor, user]);

  // Consolidação de Vendedores Externos e Indicações
  const vendedoresExternosData = useMemo(() => {
    if (!data?.vendedores) return [];
    const map: Record<string, { nome: string; qtd: number; total: number; pct: number }> = {};

    data.vendedores.forEach((v) => {
      (v.sprints || []).forEach((sp: any) => {
        const extNome = sp.vendedor_externo_nome || sp.campos_extras?.vendedor_externo_nome;
        const extPct = Number(sp.vendedor_externo_comissao_pct || sp.campos_extras?.vendedor_externo_comissao_pct || 5.0);
        if (extNome) {
          if (!map[extNome]) {
            map[extNome] = { nome: extNome, qtd: 0, total: 0, pct: extPct };
          }
          map[extNome].qtd += 1;
          map[extNome].total += Number(sp.valor || 0);
        }
      });
    });

    return Object.values(map);
  }, [data]);

  // Sync selected seller
  useEffect(() => {
    if (availableVendedores.length > 0) {
      const exists = availableVendedores.some(v => v.vendedor_id === selectedVendedorId);
      if (!exists) {
        setSelectedVendedorId(availableVendedores[0].vendedor_id);
      }
    }
  }, [availableVendedores, selectedVendedorId]);

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
      return { label: 'Meta Superada (110%+)', style: 'text-emerald-400 border-emerald-500/40 bg-emerald-950/20' };
    } else if (atingimento >= 100) {
      return { label: 'Meta Atingida (100%)', style: 'text-amber-400 border-amber-400/40 bg-amber-950/20' };
    } else if (atingimento >= 80) {
      return { label: 'Em Progresso (80%+)', style: 'text-blue-400 border-blue-400/40 bg-blue-950/20' };
    } else {
      return { label: 'Em Acompanhamento', style: 'text-slate-400 border-slate-700 bg-slate-900/40' };
    }
  };

  const selectedVendedor = availableVendedores.find(v => v.vendedor_id === selectedVendedorId) 
    || availableVendedores[0] 
    || null;

  return (
    <div className="flex flex-col h-full bg-[#030303] min-h-screen text-white font-sans overflow-y-auto pb-12">
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
        {/* Navigation Tabs: Internos vs Externos */}
        <div className="flex items-center gap-2 bg-[#09090b] p-1.5 rounded-xl border border-amber-500/20 shadow-inner w-fit">
          <button
            onClick={() => setActiveTab('INTERNOS')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition cursor-pointer ${
              activeTab === 'INTERNOS'
                ? 'bg-amber-500 text-black shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-black/40'
            }`}
          >
            <Users className="w-4 h-4" />
            Vendedores Internos
          </button>
          <button
            onClick={() => setActiveTab('EXTERNOS')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition cursor-pointer ${
              activeTab === 'EXTERNOS'
                ? 'bg-amber-500 text-black shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-black/40'
            }`}
          >
            <Share2 className="w-4 h-4" />
            Vendedores Externos / Indicações
            {vendedoresExternosData.length > 0 && (
              <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] bg-black text-amber-400 font-extrabold border border-amber-500/30">
                {vendedoresExternosData.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab 2: Vendedores Externos & Indicações */}
        {activeTab === 'EXTERNOS' && (
          <div className="bg-[#09090b] rounded-xl border border-amber-500/20 p-6 space-y-6 shadow-2xl">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-amber-500/10 pb-4">
              <div>
                <h3 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Share2 className="w-5 h-5 text-amber-500" />
                  Comissões de Vendedores Externos & Indicações
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-1">
                  Relatório consolidado de vendas indicadas por parceiros externos no mês de {mesesMap.find(m => m.value === mes)?.label}/{ano}
                </p>
              </div>

              <div className="flex items-center gap-3 bg-black/60 px-4 py-2 rounded-xl border border-amber-500/20">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Total Comissão Externa</span>
                  <span className="text-sm font-black text-emerald-400">
                    R$ {formatBRL(vendedoresExternosData.reduce((acc, curr) => acc + (curr.total * (curr.pct / 100)), 0), true)}
                  </span>
                </div>
              </div>
            </div>

            {vendedoresExternosData.length === 0 ? (
              <div className="text-center py-12 space-y-3 bg-black/30 rounded-xl border border-dashed border-amber-500/10">
                <UserCheck className="w-10 h-10 text-slate-600 mx-auto" />
                <p className="text-sm font-bold text-slate-400">Nenhuma venda externa / indicação registrada neste período.</p>
                <p className="text-xs text-slate-500">Para registrar uma venda externa, selecione "Vendedor Externo" no Canal de Venda ao realizar um pedido no PDV.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-amber-500/20 bg-black/50 text-[11px] font-black text-amber-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Vendedor Externo / Indicador</th>
                      <th className="py-3 px-4 text-center">Qtd Vendas</th>
                      <th className="py-3 px-4 text-right">Total Indicado (R$)</th>
                      <th className="py-3 px-4 text-center">% Comissão</th>
                      <th className="py-3 px-4 text-right text-emerald-400">Comissão A Pagar (R$)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-500/10 text-xs font-semibold text-slate-200">
                    {vendedoresExternosData.map((ve, idx) => {
                      const comissaoDevida = ve.total * (ve.pct / 100);
                      return (
                        <tr key={idx} className="hover:bg-amber-500/5 transition">
                          <td className="py-3.5 px-4 font-bold text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            {ve.nome}
                          </td>
                          <td className="py-3.5 px-4 text-center font-bold text-slate-300">
                            {ve.qtd}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-400">
                            R$ {formatBRL(ve.total, true)}
                          </td>
                          <td className="py-3.5 px-4 text-center font-bold text-amber-500">
                            {ve.pct}%
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-extrabold text-emerald-400">
                            R$ {formatBRL(comissaoDevida, true)}
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
        {/* Estados de Erro e Loading */}
        {loading ? (
          <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-dashed border-amber-500/20 bg-black/40">
            <div className="text-center space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-amber-500 mx-auto" />
              <p className="text-sm font-semibold text-slate-400 uppercase tracking-widest">Carregando Revisor...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-dashed border-rose-900/50 bg-rose-950/10 px-6">
            <div className="text-center space-y-3 max-w-md">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <h3 className="text-lg font-bold text-white">Falha ao carregar Revisor</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{error}</p>
              <button 
                onClick={() => refetch()}
                className="mt-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm font-bold transition shadow-lg"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : activeTab === 'INTERNOS' && (!data || data.vendedores.length === 0) ? (
          <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-dashed border-amber-500/20 bg-black/40">
            <div className="text-center space-y-2">
              <Award className="w-8 h-8 text-slate-700 mx-auto" />
              <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Nenhum vendedor registrado no período.</p>
            </div>
          </div>
        ) : activeTab === 'INTERNOS' && (
          <>
            {/* Layout Principal */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Bloco Esquerdo: Seletor e Gauges */}
              <div className="lg:col-span-3 border border-amber-500/30 rounded-xl p-6 bg-black/60 backdrop-blur-md flex flex-col justify-between min-h-[480px] shadow-[0_0_20px_rgba(217,119,6,0.02)] hover:border-amber-500/50 hover:shadow-[0_0_30px_rgba(217,119,6,0.08)] transition-all duration-300">
                {/* Dropdown Selector + Rank Tier */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-500 text-xs font-black uppercase tracking-widest">Nome:</span>
                    {isAdminOrConsultor ? (
                      <select
                        value={selectedVendedorId}
                        onChange={(e) => setSelectedVendedorId(Number(e.target.value))}
                        className="bg-black text-amber-500 border-2 border-amber-500/50 rounded px-3 py-1.5 outline-none cursor-pointer font-black focus:ring-1 focus:ring-amber-500 text-sm hover:border-amber-500 transition"
                      >
                        {availableVendedores.map((v) => (
                          <option key={v.vendedor_id} value={v.vendedor_id} className="bg-neutral-900 text-white">
                            {v.vendedor} {v.vendedor_id > 0 ? `(${v.vendedor_id})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="inline-flex items-center gap-2 bg-amber-950/40 text-amber-400 border border-amber-500/40 rounded px-3 py-1.5 text-sm font-black select-none shadow-sm">
                        <UserCheck className="w-4 h-4 text-amber-500" />
                        <span>{selectedVendedor?.vendedor || user?.nome || 'Seu Revisor'}</span>
                      </div>
                    )}
                  </div>

                  {/* Status / Meta display */}
                  {selectedVendedor && (
                    <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-black tracking-wider uppercase ${getTierInfo(selectedVendedor.atingimento_pct).style}`}>
                      <Sparkles className="w-3.5 h-3.5" />
                      Status: {getTierInfo(selectedVendedor.atingimento_pct).label}
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
                    <Award className="w-4 h-4 text-amber-500" />
                    Atingimento da Meta
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
