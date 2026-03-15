import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { buildOperationalCategoriaIds } from '../utils/planoContas';
import { 
    UploadCloud, ArrowRight, CheckCircle, AlertTriangle, 
    FileSpreadsheet, Save, Loader2, Download,
    Plus, Check, X, Wallet, Users, Layers, Tag, 
    TrendingUp, TrendingDown, Edit2, Trash2, ChevronDown, ChevronRight,
    ArrowUp, ArrowDown,
    Wand2, GripVertical 
} from 'lucide-react';

// --- INTERFACES ---
export interface ItemSistema { 
    id: number; 
    nome: string; 
    tipo?: string; 
    codigo?: string; 
    eh_operacional?: boolean;
    considerar_nos_resultados?: boolean;
    dre_grupo?: string;
    permite_lancamentos?: boolean;
    eh_cabecalho?: boolean;
    conta_pai_id?: number | null; 
    children?: ItemSistema[];     
} 

const OPERATIONAL_EDIT_EMAIL = 'cirocaue12@gmail.com';
const DRE_GRUPO_OPTIONS = [
    { value: 'RECEITA_BRUTA', label: 'Receita Bruta' },
    { value: 'DEDUCOES_RECEITA', label: 'Deduções da Receita' },
    { value: 'CUSTOS_VARIAVEIS', label: 'Custos Variáveis' },
    { value: 'DESPESAS_OPERACIONAIS', label: 'Despesas Operacionais' },
    { value: 'OUTRAS_RECEITAS', label: 'Outras Receitas' },
    { value: 'OUTRAS_DESPESAS', label: 'Outras Despesas' },
    { value: 'NAO_OPERACIONAL', label: 'Não operacional / fora da DRE' },
] as const;

const DRE_GRUPO_BADGE: Record<string, { label: string; className: string }> = {
    RECEITA_BRUTA:         { label: 'Rec. Bruta',  className: 'text-emerald-400 bg-emerald-900/20 border-emerald-900/40' },
    DEDUCOES_RECEITA:      { label: 'Deduções',    className: 'text-amber-400 bg-amber-900/20 border-amber-900/40' },
    CUSTOS_VARIAVEIS:      { label: 'Custos Var.', className: 'text-orange-400 bg-orange-900/20 border-orange-900/40' },
    DESPESAS_OPERACIONAIS: { label: 'Desp. Op.',   className: 'text-blue-400 bg-blue-900/20 border-blue-900/40' },
    OUTRAS_RECEITAS:       { label: 'Out. Rec.',   className: 'text-teal-400 bg-teal-900/20 border-teal-900/40' },
    OUTRAS_DESPESAS:       { label: 'Out. Desp.',  className: 'text-purple-400 bg-purple-900/20 border-purple-900/40' },
    NAO_OPERACIONAL:       { label: 'Não Op.',     className: 'text-slate-400 bg-slate-700/30 border-slate-600/40' },
};

const normalizeDreGrupo = (dreGrupo: string | undefined, tipo: string | undefined) => {
    const normalized = String(dreGrupo || '').trim().toUpperCase();
    if (DRE_GRUPO_OPTIONS.some((option) => option.value === normalized)) return normalized;
    return normalizeTipo(tipo) === 'R' ? 'RECEITA_BRUTA' : 'DESPESAS_OPERACIONAIS';
};

const normalizeTipo = (tipo?: string) => ((tipo || '').trim().toUpperCase().startsWith('R') ? 'R' : 'D');

function getApiErrorMessage(error: any, fallback: string) {
    const detail = error?.response?.data?.detail;
    const message = error?.response?.data?.message;
    const statusCode = error?.response?.status;

    if (Array.isArray(detail)) {
        const parsed = detail
            .map((item) => item?.msg || item?.message || String(item))
            .filter(Boolean)
            .join(' ')
            .trim();
        return parsed || fallback;
    }

    if (typeof detail === 'string' && detail.trim()) {
        return detail.trim();
    }

    if (typeof message === 'string' && message.trim()) {
        return message.trim();
    }

    if (statusCode === 405) {
        return 'O endpoint recusou o metodo HTTP enviado. Verifique a compatibilidade da rota usada pela tela.';
    }

    if (statusCode) {
        return `${fallback} (HTTP ${statusCode})`;
    }

    return fallback;
}

function getSingleCentroId(centros: ItemSistema[]) {
    return centros.length === 1 ? Number(centros[0].id) : null;
}

interface SistemaData {
  contas: ItemSistema[];
  categorias: ItemSistema[];
  centros: ItemSistema[];
  entidades: ItemSistema[];
}

interface Conflitos {
  contas: string[];
  categorias: string[];
  centros: string[];
  entidades: string[];
}

interface Feedback {
  type: 'success' | 'error';
  message: string;
  details?: string[];
}

function needsContaCadastro(message?: string) {
        const text = String(message || '').toLowerCase();
        return text.includes('contas bancarias') || text.includes('banco');
}

function needsEntidadeCadastro(message?: string) {
        const text = String(message || '').toLowerCase();
        return text.includes('interessado') || text.includes('entidade');
}

interface PlanoSectionState {
        tipo: 'R' | 'D';
        titulo: string;
        accentClassName: string;
        surfaceClassName: string;
        dropClassName: string;
}

interface PreviewRow {
        linha: number;
        descricao: string;
        tipo: string;
        valor: string;
        data_vencimento: string;
        categoria_arquivo: string;
        categoria_sugerida_id?: number | null;
        categoria_sugerida_nome?: string | null;
        entidade_arquivo: string;
        entidade_sugerida_id?: number | null;
        entidade_sugerida_nome?: string | null;
}

interface ImportJobAccepted {
    job_id: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'ERROR';
}

interface ImportJobStatus {
    job_id: string;
    kind: 'ANALYZE' | 'EXECUTE';
    filename: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'ERROR';
    progress: number;
    message: string;
    error?: string | null;
    result?: any;
}

interface SearchOption {
    id: number | string;
    nome: string;
    codigo?: string;
    depth?: number;
    disabled?: boolean;
    helperText?: string;
    searchText?: string;
}

interface SearchOptionGroup {
    label: string;
    options: SearchOption[];
}

interface QuickEntityFormState {
    nome: string;
    tipo: 'CLIENTE' | 'FORNECEDOR' | 'AMBOS';
    tipo_pessoa: 'PF' | 'PJ';
    nome_fantasia: string;
    cpf_cnpj: string;
    email: string;
    telefone: string;
    celular: string;
    contato_nome: string;
    cep: string;
    logradouro: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    observacoes: string;
}

type TreeCategoriaItem = ItemSistema & { children: TreeCategoriaItem[] };

const initialQuickEntityForm: QuickEntityFormState = {
    nome: '',
    tipo: 'AMBOS',
    tipo_pessoa: 'PF',
    nome_fantasia: '',
    cpf_cnpj: '',
    email: '',
    telefone: '',
    celular: '',
    contato_nome: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    uf: '',
    observacoes: '',
};

const IMPORT_JOB_POLL_INTERVAL_MS = 1000;
const PREVIEW_PAGE_SIZE = 200;

const onlyDigits = (value: string) => value.replace(/\D/g, '');

const formatCpfCnpj = (value: string) => {
    const digits = onlyDigits(value).slice(0, 14);
    if (digits.length <= 11) {
        return digits
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    }

    return digits
        .replace(/(\d{2})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1/$2')
        .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

const formatPhone = (value: string) => {
    const digits = onlyDigits(value).slice(0, 11);
    if (digits.length <= 10) {
        return digits
            .replace(/(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{4})(\d)/, '$1-$2');
    }

    return digits
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2');
};

const formatCep = (value: string) => onlyDigits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

const fetchCepAddress = async (cep: string) => {
    const digits = String(cep || '').replace(/\D/g, '');
    if (digits.length !== 8) {
        throw new Error('CEP inválido');
    }

    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!response.ok) {
        throw new Error('Falha ao consultar CEP');
    }

    const data = await response.json();
    if (data?.erro) {
        throw new Error('CEP não encontrado');
    }

    return {
        cep: digits,
        logradouro: String(data.logradouro || '').trim(),
        bairro: String(data.bairro || '').trim(),
        cidade: String(data.localidade || '').trim(),
        uf: String(data.uf || '').trim().toUpperCase().slice(0, 2),
    };
};

const nullableValue = (value: string) => {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const sortByCodeAndName = (items: ItemSistema[]) => [...items].sort((a, b) => {
    const codeCompare = String(a.codigo || '').localeCompare(String(b.codigo || ''), 'pt-BR', { numeric: true });
    if (codeCompare !== 0) return codeCompare;
    return a.nome.localeCompare(b.nome, 'pt-BR');
});

const buildCategoriaOptionGroups = (items: ItemSistema[]): SearchOptionGroup[] => {
    const map = new Map<number, TreeCategoriaItem>();
    items.forEach((item) => map.set(item.id, { ...item, children: [] }));

    const roots: TreeCategoriaItem[] = [];
    sortByCodeAndName(items).forEach((item) => {
        const current = map.get(item.id);
        if (!current) return;
        if (item.conta_pai_id && map.has(Number(item.conta_pai_id))) {
            map.get(Number(item.conta_pai_id))!.children.push(current);
        } else {
            roots.push(current);
        }
    });

    const flatten = (nodes: TreeCategoriaItem[], depth = 0): SearchOption[] => {
        return nodes.flatMap((node) => {
            const hasChildren = node.children.length > 0;
            const disabled = node.eh_cabecalho === true || hasChildren;
            const helperText = disabled ? 'Categoria pai / agrupadora' : undefined;
            const current: SearchOption = {
                id: node.id,
                nome: node.nome,
                codigo: node.codigo,
                depth,
                disabled,
                helperText,
                searchText: `${node.codigo || ''} ${node.nome}`.trim(),
            };
            return [current, ...flatten(sortByCodeAndName(node.children) as TreeCategoriaItem[], depth + 1)];
        });
    };

    const receitas = flatten(sortByCodeAndName(roots.filter((item) => normalizeTipo(item.tipo) === 'R')) as TreeCategoriaItem[]);
    const despesas = flatten(sortByCodeAndName(roots.filter((item) => normalizeTipo(item.tipo) === 'D')) as TreeCategoriaItem[]);
    const groups: SearchOptionGroup[] = [];
    if (receitas.length) groups.push({ label: 'Entradas', options: receitas });
    if (despesas.length) groups.push({ label: 'Saidas', options: despesas });
    return groups;
};

// --- HELPER COMPONENTS ---

const StepBadge = ({ num, current, label }: { num: number, current: number, label: string }) => {
    const active = num === current;
    const done = num < current;
    return (
        <div className={`flex items-center gap-2 ${active ? 'text-slate-900 dark:text-white' : done ? 'text-emerald-500' : 'text-slate-500'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${active ? 'border-blue-500 bg-blue-500 text-white' : done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'}`}>
                {done ? <Check className="w-4 h-4"/> : num}
            </div>
            <span className="text-sm font-bold hidden sm:block">{label}</span>
            {num < 4 && <div className={`h-0.5 w-8 ${done ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>}
        </div>
    );
};

const SearchableSelect = ({ value, options, onChange, placeholder = "Selecione...", label }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const groupedOptions = Array.isArray(options) && options.length > 0 && Array.isArray(options[0]?.options)
        ? options
        : [{ label: '', options: options || [] }];
    const flatOptions = groupedOptions.flatMap((group: SearchOptionGroup) => group.options || []);
    const selectedItem = flatOptions.find((opt: any) => String(opt.id) === String(value));

    useEffect(() => {
        function handleClickOutside(event: any) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setIsOpen(false);
                if (!value) setSearch(''); 
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [value]);

    useEffect(() => {
        if (isOpen) {
            setSearch('');
            return;
        }

        if (selectedItem) setSearch(selectedItem.searchText || selectedItem.nome);
        else setSearch('');
    }, [selectedItem, isOpen]);

    const filteredGroups = groupedOptions
        .map((group: SearchOptionGroup) => ({
            ...group,
            options: (group.options || []).filter((opt: SearchOption) => {
                const haystack = `${opt.searchText || ''} ${opt.nome || ''} ${opt.codigo || ''}`.toLowerCase();
                return haystack.includes(search.toLowerCase());
            })
        }))
        .filter((group: SearchOptionGroup) => group.options.length > 0);

    return (
        <div className="relative w-full" ref={wrapperRef}>
            {label ? <label className="mb-1 block text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{label}</label> : null}
            <div 
                className={`flex min-h-11.5 items-center justify-between rounded-xl border bg-white px-3 py-3 text-sm text-slate-800 shadow-sm transition dark:bg-slate-900 dark:text-white
                ${isOpen ? 'border-blue-500 ring-2 ring-blue-500/20' : !value ? 'border-red-500/30' : 'border-slate-300 hover:border-blue-500 dark:border-slate-600 dark:hover:border-blue-500'}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                {isOpen ? (
                    <input 
                        autoFocus
                        className="w-full bg-transparent text-slate-800 outline-none placeholder:text-slate-400 dark:text-white"
                        placeholder="Digite para buscar..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span className={`truncate ${!selectedItem ? 'text-slate-500' : ''}`}>
                        {selectedItem ? (selectedItem.codigo ? `${selectedItem.codigo} - ${selectedItem.nome}` : selectedItem.nome) : placeholder}
                    </span>
                )}
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}/>
            </div>

            {isOpen && (
                <div className="absolute z-50 mt-1 flex max-h-72 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 dark:border-slate-700 dark:bg-slate-800">
                    {filteredGroups.length === 0 ? (
                        <div className="p-3 text-slate-500 text-center text-xs italic">Nenhum item encontrado.</div>
                    ) : (
                        <div className="max-h-72 overflow-y-auto custom-scrollbar p-1">
                        {filteredGroups.map((group: SearchOptionGroup) => (
                            <div key={group.label || 'default'} className="mb-1">
                                {group.label ? <div className="mb-1 rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-900 dark:text-slate-300">{group.label}</div> : null}
                                {group.options.map((opt: SearchOption) => {
                                    const isDisabled = !!opt.disabled;
                                    return (
                                        <div 
                                            key={opt.id}
                                            className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition ${isDisabled ? 'cursor-not-allowed opacity-45 text-slate-400' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700'} ${String(opt.id) === String(value) ? 'bg-blue-600 text-white' : 'text-slate-700 dark:text-slate-300'}`}
                                            onClick={() => {
                                                if (isDisabled) return;
                                                onChange(opt.id);
                                                setIsOpen(false);
                                                setSearch(opt.searchText || opt.nome);
                                            }}
                                        >
                                            <div className="min-w-0" style={{ paddingLeft: `${(opt.depth || 0) * 14}px` }}>
                                                <div className="truncate">
                                                    {opt.codigo ? <span className="mr-2 font-mono opacity-70">{opt.codigo}</span> : ''}
                                                    {opt.nome}
                                                </div>
                                                {opt.helperText ? <div className="text-[10px] opacity-70">{opt.helperText}</div> : null}
                                            </div>
                                            {String(opt.id) === String(value) && <Check className="h-4 w-4 shrink-0"/>}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// --- ÁRVORE DRAGGABLE ---

const DraggableTreeItem = ({ item, depth = 0, inheritedOperational = false, canManageOperational = false, onDragStart, onDrop, onEdit, onDelete, onCreateChild, onMove, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onToggle, expandedIds }: any) => {
    const isExpanded = expandedIds.has(item.id);
    const hasChildren = item.children && item.children.length > 0;
    const ownOperational = item.eh_operacional !== false;
    const effectiveOperational = inheritedOperational || ownOperational;
    const inheritedOnly = inheritedOperational && item.eh_operacional === false;

    return (
        <div className="select-none">
            <div 
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                onDragOver={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation();
                    e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.08)'; 
                    e.currentTarget.style.borderColor = '#3b82f6';
                }} 
                onDragLeave={(e) => { 
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.5)'; 
                }} 
                onDrop={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation(); 
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.5)';
                    onDrop(item.id); 
                }}
                className={`group relative flex items-center p-2 mb-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-lg hover:border-slate-300 dark:hover:border-slate-600 transition-all`}
                style={{ marginLeft: `${depth * 20}px` }}
            >
                {/* Handle */}
                <div className="cursor-grab p-1 text-slate-500 dark:text-slate-600 hover:text-slate-700 dark:hover:text-slate-400 mr-1">
                    <GripVertical size={14} />
                </div>

                {/* Toggle */}
                <button onClick={(e) => { e.stopPropagation(); onToggle(item.id); }} className="p-1 mr-1 text-slate-500 hover:text-slate-900 dark:hover:text-white w-6 flex justify-center">
                    {hasChildren ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                </button>

                {/* Content */}
                <div className="flex-1 flex items-center gap-2 overflow-hidden">
                    {item.codigo ? (
                        <span className="font-mono text-[10px] font-bold text-blue-400 bg-blue-900/20 px-1.5 py-0.5 rounded border border-blue-900/30">
                            {item.codigo}
                        </span>
                    ) : (
                        <span className="text-[10px] font-bold text-orange-500 bg-orange-900/20 px-1.5 py-0.5 rounded border border-orange-900/30">Novo</span>
                    )}
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{item.nome}</span>
                    {(() => {
                        const dreKey = normalizeDreGrupo(item.dre_grupo, item.tipo);
                        const badge = DRE_GRUPO_BADGE[dreKey];
                        const inherited = inheritedOnly && effectiveOperational;
                        return badge ? (
                            <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${badge.className}`}
                                title={`Grupo DRE: ${dreKey}${inherited ? ' (herdado do pai)' : ''}`}
                            >
                                {badge.label}{inherited ? ' ↑' : ''}
                            </span>
                        ) : null;
                    })()}
                </div>

                {/* Actions */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => { e.stopPropagation(); onMoveUp(item); }}
                        title="Subir categoria"
                        disabled={!canMoveUp(item)}
                        className="p-1.5 text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <ArrowUp size={12}/>
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onMoveDown(item); }}
                        title="Descer categoria"
                        disabled={!canMoveDown(item)}
                        className="p-1.5 text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <ArrowDown size={12}/>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onCreateChild(item); }} title="Adicionar categoria filha" className="p-1.5 text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"><Plus size={12}/></button>
                    <button onClick={(e) => { e.stopPropagation(); onMove(item); }} title="Mover categoria" className="p-1.5 text-slate-400 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"><ArrowRight size={12}/></button>
                    <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} className="p-1.5 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"><Edit2 size={12}/></button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(item); }} className="p-1.5 text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"><Trash2 size={12}/></button>
                </div>
            </div>

            {/* Render Children Recursively */}
            {isExpanded && hasChildren && (
                <div className="relative">
                    <div className="absolute left-2.75 top-0 bottom-2 w-px bg-slate-300 dark:bg-slate-700/50" style={{ left: `${(depth * 20) + 11}px` }}></div>
                    {item.children.map((child: any) => (
                        <DraggableTreeItem 
                            key={child.id} 
                            item={child} 
                            depth={depth + 1} 
                            inheritedOperational={effectiveOperational}
                            canManageOperational={canManageOperational}
                            onDragStart={onDragStart}
                            onDrop={onDrop}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onCreateChild={onCreateChild}
                            onMove={onMove}
                            onMoveUp={onMoveUp}
                            onMoveDown={onMoveDown}
                            canMoveUp={canMoveUp}
                            canMoveDown={canMoveDown}
                            onToggle={onToggle}
                            expandedIds={expandedIds}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const FloatingFeedbackToast = ({ feedback, onDismiss }: { feedback: Feedback; onDismiss: () => void }) => (
    <div className="pointer-events-none fixed bottom-4 right-4 z-120 w-[min(380px,calc(100vw-2rem))] rounded-3xl border border-slate-200 bg-slate-950/95 px-4 py-4 text-left shadow-2xl shadow-slate-950/30 dark:border-slate-700 lg:bottom-6 lg:right-6">
        <div className="flex items-start gap-3">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${feedback.type === 'success' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                {feedback.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
                <p className={`text-[11px] font-bold uppercase tracking-[0.18em] ${feedback.type === 'success' ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {feedback.type === 'success' ? 'Plano atualizado' : 'Revisao necessaria'}
                </p>
                <p className="mt-2 text-sm font-semibold leading-5 text-white">{feedback.message}</p>
                {feedback.details && feedback.details.length > 0 && (
                    <div className="mt-3 space-y-1 text-xs leading-5 text-slate-300">
                        {feedback.details.map((detail, index) => (
                            <p key={`${detail}-${index}`}>{detail}</p>
                        ))}
                    </div>
                )}
            </div>
            <button
                type="button"
                onClick={onDismiss}
                className="pointer-events-auto rounded-2xl border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Fechar aviso"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    </div>
);

// --- PLANO CONTAS MANAGER (COM RECALCULO AUTOMÁTICO) ---
export const PlanoContasManager = ({
    categorias,
    onUpdateList,
    apiBasePath = '/plano-contas',
    syncWithLookupStore = true,
}: {
    categorias: ItemSistema[];
    onUpdateList: (l: any) => void;
    apiBasePath?: string;
    syncWithLookupStore?: boolean;
}) => {
    const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
    const normalizedApiBasePath = apiBasePath.endsWith('/') ? apiBasePath.slice(0, -1) : apiBasePath;
    const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [localList, setLocalList] = useState<ItemSistema[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [draggedItem, setDraggedItem] = useState<ItemSistema | null>(null);
    const [managerFeedback, setManagerFeedback] = useState<Feedback | null>(null);
        const [createTipoLocked, setCreateTipoLocked] = useState(false);
        const nextTempIdRef = useRef(-1);

  // CRUD States
  const [modalOpen, setModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<'CREATE'|'EDIT'|'MOVE'>('CREATE');
        const [formData, setFormData] = useState({ id: 0, nome: '', codigo: '', tipo: 'D', eh_operacional: true, considerar_nos_resultados: true, dre_grupo: 'DESPESAS_OPERACIONAIS', conta_pai_id: '' as number | '' });

    useEffect(() => {
            if (!managerFeedback) return;
            const timer = window.setTimeout(() => setManagerFeedback(null), 4500);
            return () => window.clearTimeout(timer);
    }, [managerFeedback]);

  useEffect(() => {
      let active = true;

      api.get('/usuarios/me')
          .then((response) => {
              if (!active) return;
              setCurrentUserEmail(String(response?.data?.email || ''));
          })
          .catch(() => {
              if (!active) return;
              setCurrentUserEmail('');
          });

      return () => {
          active = false;
      };
  }, []);

  // --- ALGORITMO DE RECALCULO DE CÓDIGOS ---
  // Esta função mágica recebe a lista plana desordenada, remonta a árvore visual
  // e atribui códigos sequenciais (1.01, 1.02...) baseados na posição.
  const recalcCodes = (items: ItemSistema[]): ItemSistema[] => {
      // 1. Separa raízes e filhos
      const map = new Map(items.map(i => [i.id, { ...i, children: [] as ItemSistema[] }]));
      const roots: ItemSistema[] = [];
      
      // Preserva a ordem original do array para respeitar o Drag & Drop do usuário
      items.forEach(item => {
          if (item.conta_pai_id && map.has(item.conta_pai_id)) {
              map.get(item.conta_pai_id)!.children!.push(map.get(item.id)!);
          } else {
              roots.push(map.get(item.id)!);
          }
      });

      // 2. Função recursiva para numerar
      const traverseAndCode = (nodes: ItemSistema[], prefix: string) => {
          nodes.forEach((node, index) => {
              const seq = (index + 1).toString().padStart(2, '0');
              const newCode = `${prefix}.${seq}`;
              
              node.codigo = newCode; // ATRIBUI O CÓDIGO AQUI
              
              if (node.children && node.children.length > 0) {
                  traverseAndCode(node.children, newCode);
              }
          });
      };

      // 3. Aplica nas Receitas (Prefixo 1)
    const receitas = roots.filter(r => normalizeTipo(r.tipo) === 'R');
      traverseAndCode(receitas, '1');

      // 4. Aplica nas Despesas (Prefixo 2)
    const despesas = roots.filter(r => normalizeTipo(r.tipo) === 'D');
      traverseAndCode(despesas, '2');

      // 5. Devolve lista plana atualizada
      const flatten = (nodes: ItemSistema[]): ItemSistema[] => {
          let flat: ItemSistema[] = [];
          nodes.forEach(node => {
              const { children, ...rest } = node;
              flat.push(rest);
              if (children && children.length > 0) flat = [...flat, ...flatten(children)];
          });
          return flat;
      };

      return flatten([...roots]); // Retorna lista plana com códigos novos
  };

  const buildInitialLocalList = (source: ItemSistema[]) => {
      const sorted = [...source].sort((a, b) => (a.codigo || 'z').localeCompare(b.codigo || 'z', undefined, { numeric: true }));
      return recalcCodes(sorted);
  };

  const markDirty = (nextList: ItemSistema[]) => {
      setLocalList(nextList);
      setHasChanges(true);
  };

  const getResolvedItemId = (itemId: number, tempIdMap: Map<number, number>) => {
      if (itemId > 0) return itemId;
      const resolvedId = tempIdMap.get(itemId);
      if (!resolvedId) {
          throw new Error('Nao foi possivel resolver uma categoria criada localmente.');
      }
      return resolvedId;
  };

  const getResolvedParentId = (parentId: number | null | undefined, tempIdMap: Map<number, number>) => {
      if (!parentId) return null;
      return getResolvedItemId(parentId, tempIdMap);
  };

  // Inicializa e já recalcula se tiver S/N
  useEffect(() => {
    const calculated = buildInitialLocalList(categorias);
    setLocalList(calculated);
    setHasChanges(false);
    setSaving(false);

    // Expande raízes
    const ids = new Set(calculated.filter(c => !c.conta_pai_id).map(c => c.id));
    setExpandedIds(prev => new Set([...prev, ...ids]));
  }, [categorias]);

  // --- BUILD TREE PARA RENDERIZAÇÃO ---
  const buildRenderTree = (items: ItemSistema[]) => {
      const map = new Map(items.map(i => [i.id, { ...i, children: [] as ItemSistema[] }]));
      const roots: ItemSistema[] = [];
      // Aqui confiamos na ordem do array (que foi reordenado pelo recalcCodes)
      items.forEach(item => {
          if (item.conta_pai_id && map.has(item.conta_pai_id)) {
              map.get(item.conta_pai_id)!.children!.push(map.get(item.id)!);
          } else {
              roots.push(map.get(item.id)!);
          }
      });
      return { roots };
  };

  const { roots } = buildRenderTree(localList);
    const receitasTree = roots.filter(c => normalizeTipo(c.tipo) === 'R');
    const despesasTree = roots.filter(c => normalizeTipo(c.tipo) === 'D');

    const sectionStates: PlanoSectionState[] = [
        {
            tipo: 'R',
            titulo: 'ENTRADAS',
            accentClassName: 'text-emerald-400',
            surfaceClassName: 'bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/50',
            dropClassName: 'rgba(16, 185, 129, 0.05)',
        },
        {
            tipo: 'D',
            titulo: 'SAIDAS',
            accentClassName: 'text-red-400',
            surfaceClassName: 'bg-slate-100 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700/50',
            dropClassName: 'rgba(239, 68, 68, 0.05)',
        },
    ];

        const refreshRemoteList = async () => {
            if (syncWithLookupStore && apiBasePath === '/plano-contas') {
                return fetchPlanoContas(true);
            }

            const response = await api.get(normalizedApiBasePath);
            return response.data || [];
        };

  const getApiErrorMessage = (error: any, fallback: string) => {
      const detail = error?.response?.data?.detail;
      const message = error?.response?.data?.message;
      const statusCode = error?.response?.status;

      if (Array.isArray(detail)) {
          const parsed = detail
              .map((item) => item?.msg || item?.message || String(item))
              .filter(Boolean)
              .join(' ')
              .trim();
          return parsed || fallback;
      }

      if (typeof detail === 'string' && detail.trim()) {
          return detail.trim();
      }

      if (typeof message === 'string' && message.trim()) {
          return message.trim();
      }

      if (statusCode === 405) {
          return 'O endpoint recusou o metodo HTTP enviado. A tela tentou salvar com uma rota/método incompatível.';
      }

      if (statusCode) {
          return `${fallback} (HTTP ${statusCode})`;
      }

      return fallback;
  };

  const descendantsMap = useMemo(() => {
      const map = new Map<number, Set<number>>();
      const collect = (node: ItemSistema): Set<number> => {
          const ids = new Set<number>([node.id]);
          (node.children || []).forEach((child) => {
              collect(child).forEach((id) => ids.add(id));
          });
          map.set(node.id, ids);
          return ids;
      };
      roots.forEach((node) => collect(node));
      return map;
  }, [roots]);

    const operationalIds = useMemo(() => buildOperationalCategoriaIds(localList), [localList]);

    const canManageOperational = currentUserEmail.trim().toLowerCase() === OPERATIONAL_EDIT_EMAIL;

    const parentOptions = useMemo(() => {
      return localList
          .filter((item) => item.id !== formData.id)
          .filter((item) => normalizeTipo(item.tipo) === normalizeTipo(formData.tipo))
          .filter((item) => !descendantsMap.get(formData.id)?.has(item.id))
          .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '', undefined, { numeric: true }) || a.nome.localeCompare(b.nome));
  }, [descendantsMap, formData.id, formData.tipo, localList]);

  const selectedParent = useMemo(
      () => (formData.conta_pai_id ? localList.find((item) => item.id === Number(formData.conta_pai_id)) || null : null),
      [formData.conta_pai_id, localList]
  );

  const resolveOperationalValue = (parentId: number | '' | null | undefined, explicitValue: boolean) => {
      if (canManageOperational) return explicitValue;
      if (!parentId) return true;
      return operationalIds.has(Number(parentId));
  };

  const resolveDreGrupoValue = (parentId: number | '' | null | undefined, explicitValue: string, tipo: string) => {
      // Sempre herda do pai quando há pai, independente de permissão
      if (parentId) {
          const parent = localList.find((item) => item.id === Number(parentId));
          if (parent?.dre_grupo) return normalizeDreGrupo(parent.dre_grupo, tipo);
      }
      return normalizeDreGrupo(explicitValue, tipo);
  };

  const syncOperationalHierarchyLocal = (items: ItemSistema[]) => {
      const itemsMap = new Map(items.map((item) => [item.id, { ...item }]));
      const childrenByParent = new Map<number, ItemSistema[]>();
      const roots: ItemSistema[] = [];

      itemsMap.forEach((item) => {
          if (item.conta_pai_id && itemsMap.has(Number(item.conta_pai_id))) {
              const parentId = Number(item.conta_pai_id);
              childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), item]);
              return;
          }
          roots.push(item);
      });

      const walk = (item: ItemSistema, inheritedValue?: boolean, inheritedDreGrupo?: string) => {
          // Regra operacional: pai=true propaga true; pai=false não força false.
          const currentValue = item.eh_operacional !== false;
          const effectiveValue = inheritedValue == null ? currentValue : (inheritedValue || currentValue);
          if (!canManageOperational) item.eh_operacional = effectiveValue;
          // Regra DRE: pai sempre propaga seu grupo para os filhos.
          const currentDre = normalizeDreGrupo(item.dre_grupo, item.tipo);
          const effectiveDre = inheritedDreGrupo ?? currentDre;
          item.dre_grupo = effectiveDre;
          (childrenByParent.get(item.id) || []).forEach((child) => walk(child, effectiveValue, effectiveDre));
      };

      roots.forEach((root) => walk(root, undefined, normalizeDreGrupo(root.dre_grupo, root.tipo)));
      return items.map((item) => itemsMap.get(item.id) || item);
  };

    const shouldShowTipoField = modalMode === 'CREATE' && !createTipoLocked && !selectedParent;

  const parentSelectGroups = useMemo<SearchOptionGroup[]>(() => {
      const options = parentOptions.map((item) => ({
          id: item.id,
          nome: item.nome,
          codigo: item.codigo,
          searchText: `${item.codigo || ''} ${item.nome}`.trim(),
      }));

      return [{ label: 'Categorias', options }];
  }, [parentOptions]);

  useEffect(() => {
      if (!selectedParent) return;
      const parentTipo = normalizeTipo(selectedParent.tipo);
      const parentDre = normalizeDreGrupo(selectedParent.dre_grupo, parentTipo);
      const tipoChanged = normalizeTipo(formData.tipo) !== parentTipo;
      const dreChanged = normalizeDreGrupo(formData.dre_grupo, formData.tipo) !== parentDre;
      if (tipoChanged || dreChanged) {
          setFormData((prev) => ({ ...prev, tipo: parentTipo, dre_grupo: parentDre, eh_operacional: parentDre !== 'NAO_OPERACIONAL' }));
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedParent?.id]);

  // --- DRAG HANDLERS ---
  const handleDragStart = (e: React.DragEvent, item: ItemSistema) => {
      setDraggedItem(item);
      e.dataTransfer.effectAllowed = 'move';
      const ghost = document.createElement('div');
      ghost.innerText = item.nome;
      ghost.style.background = '#1e293b';
      ghost.style.color = 'white';
      ghost.style.padding = '5px 10px';
      ghost.style.borderRadius = '4px';
      ghost.style.position = 'absolute';
      ghost.style.top = '-1000px';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 0, 0);
      setTimeout(() => document.body.removeChild(ghost), 0);
  };

  const handleDrop = (targetId: number | 'ROOT_R' | 'ROOT_D') => {
      if (!draggedItem) return;
      if (draggedItem.id === targetId) return; 

      // 1. Cria cópia da lista
      let newList = [...localList];
      const itemIndex = newList.findIndex(i => i.id === draggedItem.id);
      if (itemIndex === -1) return;
      
      const item = { ...newList[itemIndex] };
      newList.splice(itemIndex, 1); // Remove da posição antiga

      // 2. Atualiza pai e tipo
      if (targetId === 'ROOT_R') {
          item.conta_pai_id = null;
          item.tipo = 'R';
          newList.unshift(item); // Adiciona no topo das receitas
      } else if (targetId === 'ROOT_D') {
          item.conta_pai_id = null;
          item.tipo = 'D';
          newList.push(item); // Adiciona no fim das despesas
      } else {
          item.conta_pai_id = targetId;
          const parent = localList.find(i => i.id === targetId);
          if (parent) item.tipo = normalizeTipo(parent.tipo);
          item.eh_operacional = resolveOperationalValue(targetId, item.eh_operacional !== false);
          item.dre_grupo = resolveDreGrupoValue(targetId, item.dre_grupo || '', item.tipo || 'D');
          
          // Lógica simples: adiciona ao final da lista para ser reprocessado pelo recalcCodes
          // O recalcCodes vai colocar ele como filho do targetId corretamente na árvore
          newList.push(item);
          setExpandedIds(prev => new Set(prev).add(targetId));
      }

      // 3. MÁGICA: Recalcula todos os códigos baseados na nova estrutura
    const reindexedList = syncOperationalHierarchyLocal(recalcCodes(newList));

      markDirty(reindexedList);
      setDraggedItem(null);
  };

  const canMoveItem = (item: ItemSistema, direction: 'UP' | 'DOWN') => {
      const siblings = localList.filter((categoria) =>
          (categoria.conta_pai_id ?? null) === (item.conta_pai_id ?? null) &&
          normalizeTipo(categoria.tipo) === normalizeTipo(item.tipo)
      );
      const index = siblings.findIndex((categoria) => categoria.id === item.id);
      if (index === -1) return false;
      return direction === 'UP' ? index > 0 : index < siblings.length - 1;
  };

  const handleMoveSibling = (item: ItemSistema, direction: 'UP' | 'DOWN') => {
      const siblings = localList.filter((categoria) =>
          (categoria.conta_pai_id ?? null) === (item.conta_pai_id ?? null) &&
          normalizeTipo(categoria.tipo) === normalizeTipo(item.tipo)
      );

      const currentIndex = siblings.findIndex((categoria) => categoria.id === item.id);
      if (currentIndex === -1) return;

      const targetIndex = direction === 'UP' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= siblings.length) return;

      const targetSibling = siblings[targetIndex];
      const childrenByParent = new Map<number, ItemSistema[]>();

      localList.forEach((categoria) => {
          if (!categoria.conta_pai_id) return;
          const parentId = Number(categoria.conta_pai_id);
          childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), categoria]);
      });

      const collectSubtreeIds = (rootId: number, bag: Set<number>) => {
          bag.add(rootId);
          (childrenByParent.get(rootId) || []).forEach((child) => collectSubtreeIds(child.id, bag));
      };

      const movingIds = new Set<number>();
      collectSubtreeIds(item.id, movingIds);

      const targetIds = new Set<number>();
      collectSubtreeIds(targetSibling.id, targetIds);

      const movingBlock = localList.filter((categoria) => movingIds.has(categoria.id));
      const targetBlock = localList.filter((categoria) => targetIds.has(categoria.id));

      const startMoving = localList.findIndex((categoria) => movingIds.has(categoria.id));
      const startTarget = localList.findIndex((categoria) => targetIds.has(categoria.id));

      if (startMoving === -1 || startTarget === -1) return;

      const isExcluded = (categoria: ItemSistema) => movingIds.has(categoria.id) || targetIds.has(categoria.id);
      const baseWithoutBlocks = localList.filter((categoria) => !isExcluded(categoria));
      const insertionAnchor = direction === 'UP' ? startTarget : startMoving;
      const insertionIndex = localList.slice(0, insertionAnchor).filter((categoria) => !isExcluded(categoria)).length;
      const sequence = direction === 'UP' ? [...movingBlock, ...targetBlock] : [...targetBlock, ...movingBlock];

      const reordered = [
          ...baseWithoutBlocks.slice(0, insertionIndex),
          ...sequence,
          ...baseWithoutBlocks.slice(insertionIndex),
      ];

      const reindexedList = syncOperationalHierarchyLocal(recalcCodes(reordered));
      markDirty(reindexedList);
      if (item.conta_pai_id) {
          setExpandedIds((prev) => new Set(prev).add(Number(item.conta_pai_id)));
      }
  };

  // --- SAVE ---
  const handleSaveOrder = async () => {
    setSaving(true);
        setManagerFeedback(null);
    try {
        const originalMap = new Map(categorias.map((item) => [item.id, item]));
        const currentPositiveIds = new Set(localList.filter((item) => item.id > 0).map((item) => item.id));
        const createdItems = localList.filter((item) => item.id < 0);
        const updatedItems = localList.filter((item) => {
            if (item.id < 0) return false;
            const original = originalMap.get(item.id);
            if (!original) return false;
            return (
                original.nome !== item.nome ||
                (original.eh_operacional !== false) !== (item.eh_operacional !== false) ||
                normalizeDreGrupo(original.dre_grupo, original.tipo) !== normalizeDreGrupo(item.dre_grupo, item.tipo)
            );
        });
        const deletedItems = categorias
            .filter((item) => !currentPositiveIds.has(item.id))
            .sort((a, b) => (String(b.codigo || '').split('.').length - String(a.codigo || '').split('.').length));

        const tempIdMap = new Map<number, number>();

        for (const item of createdItems) {
            const response = await api.post(normalizedApiBasePath, {
                nome: item.nome,
                tipo: normalizeTipo(item.tipo),
                permite_lancamentos: true,
                eh_operacional: item.eh_operacional !== false,
                considerar_nos_resultados: item.considerar_nos_resultados ?? true,
                dre_grupo: normalizeDreGrupo(item.dre_grupo, item.tipo),
                conta_pai_id: getResolvedParentId(item.conta_pai_id ?? null, tempIdMap),
            });
            tempIdMap.set(item.id, response.data.id);
        }

        for (const item of updatedItems) {
            await api.patch(`${normalizedApiBasePath}/${item.id}`, {
                nome: item.nome,
                eh_operacional: item.eh_operacional !== false,
                considerar_nos_resultados: item.considerar_nos_resultados ?? true,
                dre_grupo: normalizeDreGrupo(item.dre_grupo, item.tipo),
            });
        }

        for (const item of deletedItems) {
            await api.delete(`${normalizedApiBasePath}/${item.id}`);
        }

        const payload = localList.map((item) => ({
            id: getResolvedItemId(item.id, tempIdMap),
            codigo: item.codigo,
            conta_pai_id: getResolvedParentId(item.conta_pai_id ?? null, tempIdMap),
            tipo: normalizeTipo(item.tipo),
        }));

        await api.post(`${normalizedApiBasePath}/reordenar`, payload);
        
        setHasChanges(false);
        setManagerFeedback({ type: 'success', message: 'Plano de contas salvo com sucesso.' });
        
        const updated = await refreshRemoteList();
        onUpdateList(updated);

    } catch (e: any) {
        console.error(e);
        setManagerFeedback({
            type: 'error',
            message: getApiErrorMessage(e, 'Nao foi possivel salvar a ordem do plano de contas.'),
        });
    } finally {
        setSaving(false);
    }
  };

  const handleToggle = (id: number) => {
      const newSet = new Set(expandedIds);
      if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
      setExpandedIds(newSet);
  };

  const handleDelete = async (item: ItemSistema) => {
      setManagerFeedback(null);

      const childCount = localList.filter((categoria) => categoria.conta_pai_id === item.id).length;
      if (childCount > 0) {
          setExpandedIds((prev) => new Set(prev).add(item.id));
          setManagerFeedback({
              type: 'error',
              message: `Nao foi possivel excluir \"${item.nome}\".`,
              details: [
                  `Esta categoria possui ${childCount} subcategoria(s).`,
                  'Mova ou exclua as subcategorias antes de remover a categoria pai.',
              ],
          });
          return;
      }

      markDirty(localList.filter((categoria) => categoria.id !== item.id));
      setManagerFeedback({ type: 'success', message: `Categoria \"${item.nome}\" marcada para exclusao.` });
  };

  const openCreateModal = (tipo: 'R' | 'D', contaPaiId: number | '' = '', lockTipo = false) => {
      setModalMode('CREATE');
      setCreateTipoLocked(lockTipo);
      const resolvedDreGrupo = resolveDreGrupoValue(contaPaiId, '', tipo);
      setFormData({
          id: 0,
          nome: '',
          codigo: '',
          tipo,
          eh_operacional: resolvedDreGrupo !== 'NAO_OPERACIONAL',
          considerar_nos_resultados: true,
          dre_grupo: resolvedDreGrupo,
          conta_pai_id: contaPaiId,
      });
      setModalOpen(true);
  };

  const handleSaveModal = async () => {
      setManagerFeedback(null);
      if (!formData.nome.trim() && modalMode !== 'MOVE') {
          setManagerFeedback({
              type: 'error',
              message: 'Informe o nome da categoria antes de continuar.',
          });
          return;
      }

      const normalizedTipo = normalizeTipo(formData.tipo);
        const dreGrupoValue = resolveDreGrupoValue(formData.conta_pai_id, formData.dre_grupo, normalizedTipo);
    const operationalValue = dreGrupoValue !== 'NAO_OPERACIONAL';
      if (modalMode === 'CREATE') {
          const tempId = nextTempIdRef.current;
          nextTempIdRef.current -= 1;
          const reindexed = syncOperationalHierarchyLocal(recalcCodes([
              ...localList,
              {
                  id: tempId,
                  nome: formData.nome.trim(),
                  codigo: '',
                  tipo: normalizedTipo,
                  permite_lancamentos: true,
                  eh_operacional: operationalValue,
                  considerar_nos_resultados: formData.considerar_nos_resultados,
                  dre_grupo: dreGrupoValue,
                  conta_pai_id: formData.conta_pai_id || null,
              },
          ]));
          markDirty(reindexed);
      } else {
          const reindexed = syncOperationalHierarchyLocal(recalcCodes(localList.map((categoria) => categoria.id === formData.id ? {
              ...categoria,
              nome: formData.nome.trim(),
              eh_operacional: operationalValue,
              considerar_nos_resultados: formData.considerar_nos_resultados,
              dre_grupo: dreGrupoValue,
              conta_pai_id: formData.conta_pai_id || null,
              tipo: normalizedTipo,
          } : categoria)));
          markDirty(reindexed);
      }

      setModalOpen(false);
      setCreateTipoLocked(false);
      setManagerFeedback({
          type: 'success',
          message: modalMode === 'CREATE'
              ? 'Categoria adicionada localmente. Salve as alteracoes para aplicar.'
              : modalMode === 'MOVE'
                  ? 'Categoria movida localmente. Salve as alteracoes para aplicar.'
                  : 'Categoria atualizada localmente. Salve as alteracoes para aplicar.',
      });
  };

  const handleCancelChanges = () => {
      setManagerFeedback(null);
      setModalOpen(false);
      setCreateTipoLocked(false);
      setLocalList(buildInitialLocalList(categorias));
      setHasChanges(false);
  };

  return (
    <div className="relative">
      {hasChanges && (
          <div className="mb-6 flex justify-end">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 dark:border-amber-900/50 dark:bg-amber-500/10 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Estrutura alterada. Falta salvar.
              </div>
          </div>
      )}

      {/* DUAS COLUNAS */}
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
          {sectionStates.map((section) => {
              const tree = section.tipo === 'R' ? receitasTree : despesasTree;
              const rootDropTarget = section.tipo === 'R' ? 'ROOT_R' : 'ROOT_D';

              return (
                  <div
                      key={section.tipo}
                      className={`flex min-h-125 min-w-0 flex-col rounded-[28px] p-4 ${section.surfaceClassName}`}
                      onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = section.dropClassName; }}
                      onDragLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      onDrop={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'transparent'; handleDrop(rootDropTarget); }}
                  >
                      <div className="mb-4 border-b border-slate-200 pb-3 dark:border-slate-700">
                          <div className="flex items-center justify-between gap-3">
                              <h3 className={`flex items-center gap-2 text-sm font-bold ${section.accentClassName}`}>
                                  {section.tipo === 'R' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />} {section.titulo}
                              </h3>
                              <button
                                  type="button"
                                  onClick={() => openCreateModal(section.tipo, '', true)}
                                  className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold text-white shadow-lg transition ${section.tipo === 'R' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
                              >
                                  <Plus className="h-3.5 w-3.5" />
                                  Nova categoria
                              </button>
                          </div>
                      </div>

                      <div className="flex-1 space-y-1">
                          {tree.length === 0 ? (
                              <div className="flex h-full min-h-90 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 text-center dark:border-slate-700 dark:bg-slate-900/40">
                                  <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${section.tipo === 'R' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                      {section.tipo === 'R' ? <TrendingUp className="h-6 w-6" /> : <TrendingDown className="h-6 w-6" />}
                                  </div>
                                  <button
                                      type="button"
                                      onClick={() => openCreateModal(section.tipo, '', true)}
                                      className={`mt-2 inline-flex items-center gap-2 rounded-full px-4 py-3 text-sm font-bold text-white shadow-xl transition ${section.tipo === 'R' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
                                  >
                                      <Plus className="h-4 w-4" />
                                      Criar primeira categoria
                                  </button>
                              </div>
                          ) : (
                              tree.map(item => (
                                  <DraggableTreeItem
                                      key={item.id}
                                      item={item}
                                      inheritedOperational={false}
                                      canManageOperational={canManageOperational}
                                      onDragStart={handleDragStart}
                                      onDrop={handleDrop}
                                      onEdit={(i:any)=>{ setModalMode('EDIT'); setCreateTipoLocked(false); setFormData({id:i.id, nome:i.nome, codigo:i.codigo||'', tipo:i.tipo, eh_operacional: i.eh_operacional !== false, considerar_nos_resultados: i.considerar_nos_resultados !== false, dre_grupo: normalizeDreGrupo(i.dre_grupo, i.tipo), conta_pai_id: i.conta_pai_id || ''}); setModalOpen(true); }}
                                      onCreateChild={(i:any)=>{ setExpandedIds((prev) => new Set(prev).add(i.id)); openCreateModal(normalizeTipo(i.tipo), i.id, true); }}
                                      onMove={(i:any)=>{ setModalMode('MOVE'); setCreateTipoLocked(false); setFormData({id:i.id, nome:i.nome, codigo:i.codigo||'', tipo:i.tipo, eh_operacional: i.eh_operacional !== false, considerar_nos_resultados: i.considerar_nos_resultados !== false, dre_grupo: normalizeDreGrupo(i.dre_grupo, i.tipo), conta_pai_id: i.conta_pai_id || ''}); setModalOpen(true); }}
                                      onMoveUp={(i:any)=>handleMoveSibling(i, 'UP')}
                                      onMoveDown={(i:any)=>handleMoveSibling(i, 'DOWN')}
                                      canMoveUp={(i:any)=>canMoveItem(i, 'UP')}
                                      canMoveDown={(i:any)=>canMoveItem(i, 'DOWN')}
                                      onDelete={handleDelete}
                                      onToggle={handleToggle}
                                      expandedIds={expandedIds}
                                  />
                              ))
                          )}
                      </div>
                  </div>
              );
          })}

      </div>

      {hasChanges && (
          <div className="fixed bottom-5 right-5 z-110 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full border border-white/10 bg-slate-950/95 px-4 py-3 text-white shadow-2xl shadow-slate-950/30 backdrop-blur lg:max-w-none">
              <div className="hidden sm:block">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Plano pendente</p>
                  <p className="text-sm font-semibold text-white">Salve a estrutura antes de sair.</p>
              </div>
              <button
                  type="button"
                  onClick={handleCancelChanges}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              >
                  <X className="h-4 w-4" />
                  Cancelar
              </button>
              <button
                  type="button"
                  onClick={handleSaveOrder}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-600 px-4 py-3 text-sm font-bold text-white shadow-xl transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Salvando...' : 'Salvar alteracoes'}
              </button>
          </div>
      )}

      {managerFeedback && <FloatingFeedbackToast feedback={managerFeedback} onDismiss={() => setManagerFeedback(null)} />}

      {/* MODAL */}
      {modalOpen && (
          <div className="fixed inset-0 z-80 flex items-center justify-center bg-slate-900/50 dark:bg-slate-900/80 p-4 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 p-6 rounded-xl w-full max-w-sm border border-slate-200 dark:border-slate-700 shadow-2xl animate-scale-in">
                                    <h3 className="font-bold text-slate-900 dark:text-white mb-4 text-lg">{modalMode === 'CREATE' ? 'Nova Categoria' : modalMode === 'MOVE' ? 'Mover Categoria' : 'Editar Categoria'}</h3>
                  <div className="space-y-4">
                                            {modalMode !== 'MOVE' && <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome</label>
                        <input autoFocus value={formData.nome} onChange={(e:any)=>setFormData({...formData, nome:e.target.value})} className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-white outline-none focus:border-blue-500" />
                                            </div>}
                      
                      {modalMode === 'EDIT' && (
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Código (Calculado automaticamente)</label>
                            <input disabled value={formData.codigo} className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900/50 text-slate-500 font-mono cursor-not-allowed" />
                          </div>
                      )}
                      
                      {shouldShowTipoField && (
                          <div>
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo</label>
                              <select className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white" value={formData.tipo} onChange={e=>setFormData({...formData, tipo:e.target.value})}>
                                  <option value="R">Entrada</option>
                                  <option value="D">Saida</option>
                              </select>
                          </div>
                      )}

                      <div>
                          <SearchableSelect
                              label="Categoria pai"
                              value={formData.conta_pai_id}
                              options={parentSelectGroups}
                              placeholder="Sem categoria pai"
                              onChange={(id: number | string) => {
                                  const nextParentId = id ? Number(id) : '';
                                  const parent = nextParentId ? localList.find((item) => item.id === nextParentId) : null;
                                  const nextTipo = parent ? normalizeTipo(parent.tipo) : formData.tipo;
                                  setFormData({
                                      ...formData,
                                      conta_pai_id: nextParentId,
                                      tipo: nextTipo,
                                      dre_grupo: resolveDreGrupoValue(nextParentId, formData.dre_grupo, nextTipo),
                                  });
                              }}
                          />
                          {!!formData.conta_pai_id && (
                              <button
                                  type="button"
                                  onClick={() => setFormData({ ...formData, conta_pai_id: '' })}
                                  className="mt-2 text-xs font-bold text-slate-500 transition hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                              >
                                  Remover categoria pai
                              </button>
                          )}
                      </div>

                      {modalMode !== 'MOVE' && canManageOperational && (
                          <div>
                              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Grupo da DRE</label>
                              <select
                                  className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white"
                                  value={normalizeDreGrupo(formData.dre_grupo, formData.tipo)}
                                  onChange={(e) => setFormData({ ...formData, dre_grupo: e.target.value, eh_operacional: e.target.value !== 'NAO_OPERACIONAL' })}
                              >
                                  {DRE_GRUPO_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                              </select>
                              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Define onde esta categoria entra na DRE. Selecionar <strong>Não operacional</strong> exclui a categoria de todos os indicadores.</p>
                          </div>
                      )}



                      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
                          <button onClick={()=>{ setModalOpen(false); setCreateTipoLocked(false); }} className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg font-bold">Cancelar</button>
                          <button onClick={handleSaveModal} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-lg">Salvar</button>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

// --- RESTO DO CÓDIGO DA PÁGINA (MANTIDO) ---
const MappingRow = ({ label, original, value, options, onChange, onCreate, typeLabel, icon: Icon, suggestionValue }: any) => (
    <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col md:flex-row gap-4 items-center animate-in fade-in group hover:border-slate-300 dark:hover:border-slate-600 transition">
        <div className="flex-1 w-full min-w-0">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1 group-hover:text-slate-400 transition">
                <FileSpreadsheet className="w-3 h-3"/> {label || 'No Arquivo'}
            </p>
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white font-mono text-sm truncate" title={original}>
                {original}
            </div>
        </div>
        <ArrowRight className="text-slate-600 hidden md:block w-5 h-5 shrink-0" />
        <div className="flex-1 w-full min-w-0">
            <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2">
                    <p className="text-[10px] text-blue-500 uppercase font-bold flex items-center gap-1 group-hover:text-blue-400 transition">
                        <Icon className="w-3 h-3"/> No Sistema
                    </p>
                    {suggestionValue ? (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${String(value) === String(suggestionValue) ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300'}`}>
                            {String(value) === String(suggestionValue) ? 'Sugerido aplicado' : 'Sugestão disponível'}
                        </span>
                    ) : null}
                </div>
                <button onClick={onCreate} className="text-[10px] bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 hover:text-emerald-400 px-2 py-0.5 rounded font-bold flex items-center gap-1 transition">
                    <Plus className="w-3 h-3"/> Criar {typeLabel}
                </button>
            </div>
            <SearchableSelect 
                value={value} 
                options={options} 
                onChange={onChange} 
                placeholder={`Selecione ou Crie ${typeLabel}`}
            />
        </div>
    </div>
);

export function Importacao() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
    const [isDragActive, setIsDragActive] = useState(false);
    const dragCounterRef = useRef(0);
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [file, setFile] = useState<File | null>(null);
    const [importJob, setImportJob] = useState<ImportJobStatus | null>(null);
    const isMountedRef = useRef(true);
  
  const [sistemaData, setSistemaData] = useState<SistemaData>({ contas: [], categorias: [], centros: [], entidades: [] });
  const [conflitos, setConflitos] = useState<Conflitos>({ contas: [], categorias: [], centros: [], entidades: [] });
  
  const [mapCategorias, setMapCategorias] = useState<Record<string, string>>({});
  const [mapContas, setMapContas] = useState<Record<string, string>>({});
  const [mapCentros, setMapCentros] = useState<Record<string, string>>({});
  const [mapEntidades, setMapEntidades] = useState<Record<string, string>>({});
    const [suggestedCategorias, setSuggestedCategorias] = useState<Record<string, string>>({});
    const [suggestedEntidades, setSuggestedEntidades] = useState<Record<string, string>>({});
    const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
        const [previewVisibleCount, setPreviewVisibleCount] = useState(PREVIEW_PAGE_SIZE);
    const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
    const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
    const setEntidadesCache = useLookupStore((state) => state.setEntidades);
    const setEntidadesLookup = useLookupStore((state) => state.setEntidadesLookup);
    const setPlanoContasCache = useLookupStore((state) => state.setPlanoContas);
  
    const [modalOpen, setModalOpen] = useState(false);
    const [modalType, setModalType] = useState<'CATEGORIA'|'ENTIDADE'|'CONTA'|'CENTRO' | null>(null);
    const [modalValue, setModalValue] = useState('');
    const [modalPendingKey, setModalPendingKey] = useState('');
    const [entityForm, setEntityForm] = useState<QuickEntityFormState>(initialQuickEntityForm);
    const [entityCepLoading, setEntityCepLoading] = useState(false);
    const [entityCepFeedback, setEntityCepFeedback] = useState<string | null>(null);
    const lastEntityCepLookupRef = useRef('');

    const categoriaSelectOptions = useMemo(() => buildCategoriaOptionGroups(sistemaData.categorias), [sistemaData.categorias]);
    const entidadeSelectOptions = useMemo<SearchOption[]>(() =>
        [...sistemaData.entidades]
            .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
            .map((item) => ({ id: item.id, nome: item.nome, searchText: item.nome })),
    [sistemaData.entidades]);
    const categoriasById = useMemo(() => new Map(sistemaData.categorias.map((item) => [String(item.id), item])), [sistemaData.categorias]);
    const entidadesById = useMemo(() => new Map(sistemaData.entidades.map((item) => [String(item.id), item])), [sistemaData.entidades]);
    const previewResolvedRows = useMemo(() => previewRows.map((row) => {
        const categoriaMapeadaId = mapCategorias[row.categoria_arquivo] || (row.categoria_sugerida_id ? String(row.categoria_sugerida_id) : '');
        const entidadeMapeadaId = mapEntidades[row.entidade_arquivo] || (row.entidade_sugerida_id ? String(row.entidade_sugerida_id) : '');
        const categoriaItem = categoriaMapeadaId ? categoriasById.get(categoriaMapeadaId) : null;
        const entidadeItem = entidadeMapeadaId ? entidadesById.get(entidadeMapeadaId) : null;
        return {
            ...row,
            categoria_final: categoriaItem ? `${categoriaItem.codigo ? `${categoriaItem.codigo} - ` : ''}${categoriaItem.nome}` : (row.categoria_arquivo || 'A Categorizar'),
            entidade_final: entidadeItem ? entidadeItem.nome : (row.entidade_arquivo || 'Sem interessado'),
            categoria_auto: !mapCategorias[row.categoria_arquivo] && !!row.categoria_sugerida_id,
            entidade_auto: !mapEntidades[row.entidade_arquivo] && !!row.entidade_sugerida_id,
        };
    }), [previewRows, mapCategorias, mapEntidades, categoriasById, entidadesById]);
    const visiblePreviewRows = useMemo(
        () => previewResolvedRows.slice(0, previewVisibleCount),
        [previewResolvedRows, previewVisibleCount],
    );
    const hasMorePreviewRows = visiblePreviewRows.length < previewResolvedRows.length;

    const documentoInteressadoLabel = entityForm.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ';
    const nomeInteressadoLabel = entityForm.tipo_pessoa === 'PF' ? 'Nome completo' : 'Razão social';

    useEffect(() => {
        carregarDadosIniciais();
    }, []);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
        };
    }, []);

  function handleEntityDocumentoChange(value: string) {
      const formatted = formatCpfCnpj(value);
      const digits = onlyDigits(formatted);
      setEntityForm((prev) => ({
          ...prev,
          cpf_cnpj: formatted,
          tipo_pessoa: digits.length > 11 ? 'PJ' : prev.tipo_pessoa === 'PJ' && digits.length > 0 && digits.length <= 11 ? 'PF' : prev.tipo_pessoa,
      }));
  }

    function handlePreviewScroll(event: UIEvent<HTMLDivElement>) {
      if (!hasMorePreviewRows) {
          return;
      }

      const element = event.currentTarget;
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining <= 96) {
          setPreviewVisibleCount((prev) => Math.min(prev + PREVIEW_PAGE_SIZE, previewResolvedRows.length));
      }
  }

  function handleUploadDragEnter() {
      dragCounterRef.current += 1;
      setIsDragActive(true);
  }

  function handleUploadDragLeave() {
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
          setIsDragActive(false);
      }
  }

  function handleUploadDrop() {
      dragCounterRef.current = 0;
      setIsDragActive(false);
  }

  async function handleEntityCepChange(value: string) {
      const formatted = formatCep(value);
      const digits = onlyDigits(formatted);
      setEntityForm((prev) => ({ ...prev, cep: formatted }));

      if (digits.length < 8) {
          lastEntityCepLookupRef.current = '';
          setEntityCepFeedback(null);
          return;
      }

      if (digits === lastEntityCepLookupRef.current) {
          return;
      }

      setEntityCepLoading(true);
      setEntityCepFeedback(null);
      try {
          const address = await fetchCepAddress(digits);
          lastEntityCepLookupRef.current = digits;
          setEntityForm((prev) => ({
              ...prev,
              cep: formatCep(address.cep),
              logradouro: address.logradouro,
              bairro: address.bairro,
              cidade: address.cidade,
              uf: address.uf,
          }));
          setEntityCepFeedback('Endereço preenchido automaticamente pelo CEP.');
      } catch (error: any) {
          lastEntityCepLookupRef.current = '';
          setEntityCepFeedback(error?.message || 'Não foi possível consultar o CEP.');
      } finally {
          setEntityCepLoading(false);
      }
  }

  async function carregarDadosIniciais() {
    try {
            const [rContas, rCats, rCentros, rEnt] = await Promise.all([
                api.get('/contas/', { params: { include_saldo: false } }),
                fetchPlanoContas(),
                api.get('/centro-custo/'),
                fetchEntidadesLookup()
            ]);
            setSistemaData({ contas: rContas.data || [], categorias: rCats || [], centros: rCentros.data || [], entidades: rEnt || [] });
    } catch (error) { console.error("Erro dados iniciais", error); setFeedback({ type: 'error', message: 'Falha ao carregar dados.' }); }
  }

  const handleCategoriesUpdate = (newCats: ItemSistema[]) => {
      setSistemaData(prev => ({ ...prev, categorias: newCats }));
            setPlanoContasCache(newCats);
  };

  async function handleDownloadModelo() {
    try {
        const response = await api.get('/lancamentos/importar/modelo', { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url; link.setAttribute('download', 'modelo_kyrus.xlsx');
        document.body.appendChild(link); link.click(); link.parentNode?.removeChild(link); window.URL.revokeObjectURL(url);
    } catch (error) { setFeedback({ type: 'error', message: 'Erro ao baixar o modelo.' }); }
  }

  function applyAnalysisResult(data: any) {
      setConflitos({ ...data.conflitos, entidades: data.conflitos.entidades || [] });
      if (data.sistema) setSistemaData(prev => ({ ...prev, ...data.sistema }));
      if (data.sugestoes?.categorias) {
          const nextSuggestions: Record<string, string> = {};
          Object.entries(data.sugestoes.categorias).forEach(([key, value]) => { nextSuggestions[key] = String(value); });
          setSuggestedCategorias(nextSuggestions);
          setMapCategorias((prev) => {
              const next = { ...prev };
              Object.entries(data.sugestoes.categorias).forEach(([key, value]) => {
                  if (!next[key]) next[key] = String(value);
              });
              return next;
          });
      } else {
          setSuggestedCategorias({});
      }

      if (data.sugestoes?.entidades) {
          const nextSuggestions: Record<string, string> = {};
          Object.entries(data.sugestoes.entidades).forEach(([key, value]) => { nextSuggestions[key] = String(value); });
          setSuggestedEntidades(nextSuggestions);
          setMapEntidades((prev) => {
              const next = { ...prev };
              Object.entries(data.sugestoes.entidades).forEach(([key, value]) => {
                  if (!next[key]) next[key] = String(value);
              });
              return next;
          });
      } else {
          setSuggestedEntidades({});
      }

      setPreviewRows(data.preview || []);
      setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
      setStep(2);
  }

  async function waitForImportJob(jobId: string) {
      while (true) {
          await new Promise((resolve) => window.setTimeout(resolve, IMPORT_JOB_POLL_INTERVAL_MS));
          if (!isMountedRef.current) {
              return {
                  job_id: jobId,
                  kind: 'ANALYZE',
                  filename: '',
                  status: 'ERROR',
                  progress: 0,
                  message: 'Importação interrompida.',
              } as ImportJobStatus;
          }

          const { data } = await api.get<ImportJobStatus>(`/lancamentos/importar/jobs/${jobId}`, {
              timeout: 0,
          });
          if (!isMountedRef.current) {
              return data;
          }
          setImportJob(data);

          if (data.status === 'COMPLETED') {
              return data;
          }

          if (data.status === 'ERROR') {
              throw new Error(data.error || data.message || 'Falha no processamento do arquivo.');
          }
      }
  }

  async function handleAnalise() {
    if (!file) return;
                setLoading(true); setFeedback(null); setPreviewRows([]); setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
    const fd = new FormData(); fd.append('file', file);
    try {
            const { data } = await api.post<ImportJobAccepted>('/lancamentos/importar/analisar-async', fd, {
                timeout: 0,
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
            setImportJob({
                job_id: data.job_id,
                kind: 'ANALYZE',
                filename: file.name,
                status: data.status,
                progress: 0,
                message: 'Arquivo enviado. Iniciando análise...',
            });
            const completedJob = await waitForImportJob(data.job_id);
            applyAnalysisResult(completedJob.result || {});
            setImportJob(null);
    } catch (e: any) {
        setImportJob(null);
        setFeedback({ type: 'error', message: e.response?.data?.detail || e.message || 'Erro ao analisar arquivo.' });
    } finally { setLoading(false); }
  }

  async function handleQuickCreate() {
            if(modalType !== 'ENTIDADE' && !modalValue) return;
            if (modalType === 'ENTIDADE' && !entityForm.nome.trim()) return;
      setLoading(true);
      try {
          let res: any; let newItem: any;
          if(modalType === 'CATEGORIA') {
              const tipo = (modalValue || '').trim().toUpperCase().startsWith('R') ? 'R' : 'D';
              res = await api.post('/plano-contas/', { nome: modalValue, tipo: tipo, permite_lancamentos: true, eh_operacional: true, considerar_nos_resultados: true }); 
              newItem = res.data;
              setSistemaData(prev => {
                const next = [...prev.categorias, newItem];
                setPlanoContasCache(next);
                return { ...prev, categorias: next };
              });
              setMapCategorias(prev => ({...prev, [modalPendingKey]: String(newItem.id)}));
          } else if (modalType === 'ENTIDADE') {
              res = await api.post('/entidades/', {
                  nome: entityForm.nome.trim(),
                  tipo: entityForm.tipo,
                  tipo_pessoa: entityForm.tipo_pessoa,
                  nome_fantasia: nullableValue(entityForm.nome_fantasia),
                  cpf_cnpj: nullableValue(onlyDigits(entityForm.cpf_cnpj)),
                  email: nullableValue(entityForm.email),
                  telefone: nullableValue(onlyDigits(entityForm.telefone)),
                  celular: nullableValue(onlyDigits(entityForm.celular)),
                  contato_nome: nullableValue(entityForm.contato_nome),
                  cep: nullableValue(onlyDigits(entityForm.cep)),
                  logradouro: nullableValue(entityForm.logradouro),
                  numero: nullableValue(entityForm.numero),
                  complemento: nullableValue(entityForm.complemento),
                  bairro: nullableValue(entityForm.bairro),
                  cidade: nullableValue(entityForm.cidade),
                  uf: nullableValue(entityForm.uf.toUpperCase().slice(0, 2)),
                  observacoes: nullableValue(entityForm.observacoes),
                  status: 'ATIVO'
              });
              newItem = res.data;
                            setSistemaData(prev => {
                                const next = [...prev.entidades, newItem];
                                setEntidadesCache(next);
                                setEntidadesLookup(next);
                                return { ...prev, entidades: next };
                            });
              setMapEntidades(prev => ({...prev, [modalPendingKey]: String(newItem.id)}));
          } else if (modalType === 'CONTA') {
              const centroCustoId = getSingleCentroId(sistemaData.centros);
              res = await api.post('/contas/', {
                  nome: modalValue,
                  tipo: 'CORRENTE',
                  centro_custo_id: centroCustoId,
              });
              newItem = res.data;
              setSistemaData(prev => ({...prev, contas: [...prev.contas, newItem]}));
              setMapContas(prev => ({...prev, [modalPendingKey]: String(newItem.id)}));
          } else if (modalType === 'CENTRO') {
              res = await api.post('/centro-custo/', { nome: modalValue });
              newItem = res.data;
              setSistemaData(prev => ({...prev, centros: [...prev.centros, newItem]}));
              setMapCentros(prev => ({...prev, [modalPendingKey]: String(newItem.id)}));
          }
          setModalOpen(false);
          setModalValue('');
          setEntityForm(initialQuickEntityForm);
          setEntityCepFeedback(null);
          lastEntityCepLookupRef.current = '';
      } catch(e) {
          const message = getApiErrorMessage(e, 'Nao foi possivel criar o item.');
          setFeedback({ type: 'error', message });
      } finally { setLoading(false); }
  }

  async function handleBulkCreate(type: 'CATEGORIA' | 'ENTIDADE' | 'CONTA' | 'CENTRO') {
      const missingList = type === 'CATEGORIA' ? conflitos.categorias.filter(k => !mapCategorias[k]) :
                          type === 'ENTIDADE' ? conflitos.entidades.filter(k => !mapEntidades[k]) :
                          type === 'CONTA' ? conflitos.contas.filter(k => !mapContas[k]) :
                          conflitos.centros.filter(k => !mapCentros[k]);
      const normalizedMissingList = Array.from(
          new Map(
              missingList
                  .map((name) => String(name || '').trim())
                  .filter(Boolean)
                  .map((name) => [name.toLocaleUpperCase('pt-BR'), name]),
          ).values(),
      );
      
      if (normalizedMissingList.length === 0) return;
      setBulkLoading(type);

      try {
          if (type === 'ENTIDADE') {
              const { data } = await api.post('/entidades/bulk', normalizedMissingList.map((name) => ({ nome: name })));
              const createdItems = Array.isArray(data) ? data : [];
              setSistemaData(prev => {
                  const next = [...prev.entidades, ...createdItems.filter((item) => !prev.entidades.some((existing) => existing.id === item.id))];
                  setEntidadesCache(next);
                  setEntidadesLookup(next);
                  return { ...prev, entidades: next };
              });
              createdItems.forEach((item: any) => {
                  setMapEntidades(prev => ({ ...prev, [item.nome]: String(item.id) }));
              });
              return;
          }

          const results = await Promise.allSettled(normalizedMissingList.map(async (name) => {
              if (type === 'CATEGORIA') {
                  const tipo = name.toUpperCase().startsWith('R') ? 'R' : 'D';
                  const response = await api.post('/plano-contas/', { nome: name, tipo, permite_lancamentos: true, eh_operacional: true, considerar_nos_resultados: true });
                  return { name, data: response.data };
              }
              if (type === 'CONTA') {
                  const response = await api.post('/contas/', {
                      nome: name,
                      tipo: 'CORRENTE',
                      centro_custo_id: getSingleCentroId(sistemaData.centros),
                  });
                  return { name, data: response.data };
              }
              const response = await api.post('/centro-custo/', { nome: name });
              return { name, data: response.data };
          }));

          const successResults = results
              .filter((result): result is PromiseFulfilledResult<{ name: string; data: any }> => result.status === 'fulfilled')
              .map((result) => result.value);
          const failedResults = results.filter((result) => result.status === 'rejected');

          successResults.forEach((res) => {
              if (!res) return;
              if (type === 'CATEGORIA') {
                                    setSistemaData(prev => {
                                        const next = [...prev.categorias, res.data];
                                        setPlanoContasCache(next);
                                        return { ...prev, categorias: next };
                                    });
                  setMapCategorias(prev => ({ ...prev, [res.name]: String(res.data.id) }));
              } else if (type === 'CONTA') {
                  setSistemaData(prev => ({ ...prev, contas: [...prev.contas, res.data] }));
                  setMapContas(prev => ({ ...prev, [res.name]: String(res.data.id) }));
              } else if (type === 'CENTRO') {
                  setSistemaData(prev => ({ ...prev, centros: [...prev.centros, res.data] }));
                  setMapCentros(prev => ({ ...prev, [res.name]: String(res.data.id) }));
              }
          });

          if (failedResults.length > 0) {
              const plural = failedResults.length > 1 ? 'itens' : 'item';
              const firstError = failedResults[0] as PromiseRejectedResult | undefined;
              const detail = firstError?.reason ? getApiErrorMessage(firstError.reason, 'Falha ao criar um ou mais itens.') : undefined;
              setFeedback({
                  type: successResults.length > 0 ? 'success' : 'error',
                  message: successResults.length > 0
                      ? `${successResults.length} ${plural} criado(s), mas ${failedResults.length} falharam.`
                      : `Nao foi possivel criar ${failedResults.length} ${plural}.`,
                  details: detail ? [detail] : undefined,
              });
          }

      } catch (e) {
          console.error(e);
          setFeedback({ type: 'error', message: getApiErrorMessage(e, 'Erro ao criar itens em massa.') });
      } finally {
          setBulkLoading(null);
      }
  }

  function openCreateModal(type: any, excelKey: string) {
      setModalType(type);
      setModalPendingKey(excelKey);
      setModalValue(excelKey);
      setEntityForm({ ...initialQuickEntityForm, nome: excelKey, nome_fantasia: excelKey });
      setEntityCepFeedback(null);
      lastEntityCepLookupRef.current = '';
      setModalOpen(true);
  }

  async function handleExecutar() {
      setLoading(true);
      setFeedback(null);
      const fd = new FormData(); fd.append('file', file!);
      fd.append('mapeamento_json', JSON.stringify({ map_categorias: mapCategorias, map_contas: mapContas, map_centros: mapCentros, map_entidades: mapEntidades }));
      try {
                    const { data } = await api.post<ImportJobAccepted>('/lancamentos/importar/executar-async', fd, {
                        timeout: 0,
                        maxBodyLength: Infinity,
                        maxContentLength: Infinity,
                    });
                    setImportJob({
                        job_id: data.job_id,
                        kind: 'EXECUTE',
                        filename: file?.name || 'arquivo.xlsx',
                        status: data.status,
                        progress: 0,
                        message: 'Arquivo enviado. Iniciando importação...',
                    });
                    const completedJob = await waitForImportJob(data.job_id);
                    const result = completedJob.result || {};
          setFeedback({ type: 'success', message: `${result.importados || 0} lançamentos importados com sucesso!`, details: result.erros });
          setImportJob(null);
          setStep(1); setFile(null); setPreviewRows([]); setPreviewVisibleCount(PREVIEW_PAGE_SIZE);
          setConflitos({ contas: [], categorias: [], centros: [], entidades: [] });
          setMapCategorias({}); setMapContas({}); setMapCentros({}); setMapEntidades({});
          setSuggestedCategorias({}); setSuggestedEntidades({});
      } catch(e: any) {
          setImportJob(null);
          setFeedback({ type: 'error', message: e.response?.data?.detail || e.message || 'Erro na importação.' });
      } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 overflow-y-auto custom-scrollbar p-6 pb-32">
      <div className="max-w-5xl mx-auto w-full mb-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
            <div><h1 className="text-2xl font-bold flex items-center gap-2 text-slate-900 dark:text-white"><UploadCloud className="w-8 h-8 text-blue-500" />Importação Inteligente</h1><p className="text-slate-500 dark:text-slate-400 mt-1">Concilie dados externos com seu sistema.</p></div>
            <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <StepBadge num={1} current={step} label="Upload" /><StepBadge num={2} current={step} label="Classificação" /><StepBadge num={3} current={step} label="Origem" /><StepBadge num={4} current={step} label="Validação" />
            </div>
        </div>
        {feedback && (
            <div className={`p-4 rounded-xl border flex items-start gap-3 mb-6 animate-in slide-in-from-top-2 ${feedback.type === 'success' ? 'bg-emerald-900/20 border-emerald-800 text-emerald-300' : 'bg-red-900/20 border-red-800 text-red-300'}`}>
                {feedback.type === 'success' ? <CheckCircle className="w-5 h-5 shrink-0"/> : <AlertTriangle className="w-5 h-5 shrink-0"/>}
                <div className="flex-1">
                    <strong className="block text-sm">{feedback.message}</strong>
                    {feedback.details && <ul className="mt-2 list-disc list-inside text-xs opacity-80 max-h-32 overflow-y-auto custom-scrollbar">{feedback.details.map((d,i)=><li key={i}>{d}</li>)}</ul>}
                    {(needsContaCadastro(feedback.message) || needsEntidadeCadastro(feedback.message)) && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {needsContaCadastro(feedback.message) && (
                                <Link to="/contas" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                    Ir para Bancos
                                </Link>
                            )}
                            {needsEntidadeCadastro(feedback.message) && (
                                <Link to="/entidades" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                    Ir para Interessados
                                </Link>
                            )}
                        </div>
                    )}
                </div>
                <button onClick={()=>setFeedback(null)}><X className="w-4 h-4 hover:text-white"/></button>
            </div>
        )}
        {importJob && (importJob.status === 'PENDING' || importJob.status === 'RUNNING') && (
            <div className="mb-6 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm dark:border-blue-900/60 dark:bg-slate-800">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-300">
                            {importJob.kind === 'ANALYZE' ? 'Analisando planilha' : 'Importando lançamentos'}
                        </p>
                        <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-white">{importJob.message}</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{importJob.filename}</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-bold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {importJob.progress}%
                    </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${Math.max(importJob.progress, 4)}%` }} />
                </div>
            </div>
        )}
        <div className="grid grid-cols-1 gap-4 mb-8 lg:grid-cols-2">
            <Link to="/importacao_interessados" className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-blue-500">Interessados</p>
                        <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Importar interessados</h3>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Suba uma planilha própria com CPF/CNPJ, contato responsável, e-mail, telefone, celular/WhatsApp, CEP e número.</p>
                    </div>
                    <div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                        <Users className="w-6 h-6" />
                    </div>
                </div>
                <div className="mt-4 text-sm font-bold text-blue-600 dark:text-blue-300">Abrir fluxo de interessados</div>
            </Link>
            <Link to="/importacao_ofx" className="group rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-500">OFX Multibancos</p>
                        <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Conciliação OFX inteligente</h3>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Cruze receitas e despesas com previstos e atrasados usando tolerância de até 5% sobre o valor do movimento.</p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <UploadCloud className="w-6 h-6" />
                    </div>
                </div>
                <div className="mt-4 text-sm font-bold text-emerald-600 dark:text-emerald-300">Abrir fluxo OFX</div>
            </Link>
        </div>
        
        {/* STEP 1: UPLOAD */}
        {step === 1 && (
            <div
                onDragEnter={handleUploadDragEnter}
                onDragLeave={handleUploadDragLeave}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleUploadDrop}
                className={`bg-white dark:bg-slate-800 p-10 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center min-h-100 border-dashed relative overflow-hidden transition-all duration-300 ${isDragActive ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/20 scale-[1.01] shadow-2xl shadow-blue-900/10' : 'hover:border-blue-500/50'}`}
            >
                <input type="file" accept=".xlsx,.xls" onChange={e=>setFile(e.target.files?.[0]||null)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" />
                <div className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${isDragActive ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="absolute inset-x-8 inset-y-6 rounded-[28px] border-2 border-dashed border-blue-400/70 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.18),transparent_58%)]" />
                    <div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-300/60 animate-ping" />
                    <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/15 backdrop-blur-sm" />
                </div>
                <div className="text-center space-y-4 pointer-events-none">
                    <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 transition-all duration-300 ${isDragActive ? 'bg-blue-500 text-white shadow-xl shadow-blue-500/25 -translate-y-1' : 'bg-blue-500/10 text-blue-500 animate-pulse-slow'}`}><FileSpreadsheet className="w-12 h-12"/></div>
                    {file ? (<div className="animate-in fade-in zoom-in-95"><h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">{file.name}</h3><p className="text-emerald-400 font-mono text-sm">{(file.size/1024).toFixed(1)} KB • Pronto para envio</p></div>) : isDragActive ? (<div className="animate-in fade-in zoom-in-95"><h3 className="text-2xl font-bold text-blue-700 dark:text-blue-300 mb-2">Solte a planilha aqui</h3><p className="text-blue-600/80 dark:text-blue-200/80">O arquivo será anexado assim que você soltar, com destaque visual no estilo de conversa.</p></div>) : (<div><h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Arraste ou clique para selecionar</h3><p className="text-slate-500 dark:text-slate-400">Suporta arquivos Excel (.xlsx, .xls)</p></div>)}
                </div>
                <div className="mt-10 z-20 flex gap-4">
                    <button onClick={handleDownloadModelo} className="px-5 py-2.5 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white font-bold flex gap-2 items-center transition"><Download className="w-4 h-4"/> Baixar Modelo</button>
                    <button onClick={handleAnalise} disabled={!file||loading} className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 flex gap-2 items-center disabled:opacity-50 disabled:cursor-not-allowed transition hover:scale-105 active:scale-95">{loading && importJob?.kind === 'ANALYZE' ? <Loader2 className="animate-spin w-5 h-5"/> : <ArrowRight className="w-5 h-5"/>} {loading && importJob?.kind === 'ANALYZE' ? 'Analisando...' : 'Continuar'}</button>
                </div>
            </div>
        )}

        {/* STEP 2: CATEGORIAS E INTERESSADOS */}
        {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8">
                
                {/* MANAGER DE CATEGORIAS */}
                <PlanoContasManager categorias={sistemaData.categorias} onUpdateList={handleCategoriesUpdate} />
                
                {/* CATEGORIAS CONFLITANTES */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"><Tag className="text-blue-500"/> Categorias Encontradas ({conflitos.categorias.length})</h3>
                        {conflitos.categorias.length > 0 && (
                            <button onClick={() => handleBulkCreate('CATEGORIA')} disabled={!!bulkLoading} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow transition disabled:opacity-50">
                                {bulkLoading === 'CATEGORIA' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>} Resolver Tudo
                            </button>
                        )}
                    </div>
                    {conflitos.categorias.length === 0 && <div className="p-4 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Tudo certo! Todas as categorias do arquivo já existem.</div>}
                    <div className="space-y-3">{conflitos.categorias.map(k => (<MappingRow key={k} original={k} value={mapCategorias[k]} suggestionValue={suggestedCategorias[k]} options={categoriaSelectOptions} onChange={(v:string)=>setMapCategorias(p=>({...p,[k]:String(v)}))} onCreate={()=>openCreateModal('CATEGORIA', k)} typeLabel="Categoria" icon={Tag} />))}</div>
                </div>

                {/* INTERESSADOS */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"><Users className="text-purple-500"/> Interessados Encontrados ({conflitos.entidades.length})</h3>
                        {conflitos.entidades.length > 0 && (
                            <button onClick={() => handleBulkCreate('ENTIDADE')} disabled={!!bulkLoading} className="text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow transition disabled:opacity-50">
                                {bulkLoading === 'ENTIDADE' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>} Criar Todas
                            </button>
                        )}
                    </div>
                    {conflitos.entidades.length === 0 ? (
                        <div className="p-4 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Nenhum interessado novo detectado.</div>
                    ) : (
                        <div className="space-y-3">{conflitos.entidades.map(k => (<MappingRow key={k} original={k} value={mapEntidades[k]} suggestionValue={suggestedEntidades[k]} options={entidadeSelectOptions} onChange={(v:string)=>setMapEntidades(p=>({...p,[k]:String(v)}))} onCreate={()=>openCreateModal('ENTIDADE', k)} typeLabel="Interessado" icon={Users} />))}</div>
                    )}
                </div>

                <div className="flex justify-between pt-6 border-t border-slate-200 dark:border-slate-800"><button onClick={()=>setStep(1)} className="px-6 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold transition">Voltar</button><button onClick={()=>setStep(3)} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg flex gap-2 items-center hover:scale-105 active:scale-95 transition">Próximo <ArrowRight className="w-4 h-4"/></button></div>
            </div>
        )}

        {/* STEP 3: CONTAS E CENTROS */}
        {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8">
                
                {/* CONTAS */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"><Wallet className="text-emerald-500"/> Contas Bancárias ({conflitos.contas.length})</h3>
                        {conflitos.contas.length > 0 && (
                            <button onClick={() => handleBulkCreate('CONTA')} disabled={!!bulkLoading} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow transition disabled:opacity-50">
                                {bulkLoading === 'CONTA' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>} Criar Todas
                            </button>
                        )}
                    </div>
                    {conflitos.contas.length === 0 && <div className="p-4 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Tudo certo com as contas.</div>}
                    <div className="space-y-3">{conflitos.contas.map(k => (<MappingRow key={k} original={k} value={mapContas[k]} options={sistemaData.contas} onChange={(v:string)=>setMapContas(p=>({...p,[k]:String(v)}))} onCreate={()=>openCreateModal('CONTA', k)} typeLabel="Conta" icon={Wallet} />))}</div>
                </div>

                {/* CENTROS */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"><Layers className="text-orange-500"/> Centros de Custo ({conflitos.centros.length})</h3>
                        {conflitos.centros.length > 0 && (
                            <button onClick={() => handleBulkCreate('CENTRO')} disabled={!!bulkLoading} className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow transition disabled:opacity-50">
                                {bulkLoading === 'CENTRO' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>} Criar Todas
                            </button>
                        )}
                    </div>
                    <div className="space-y-3">{conflitos.centros.map(k => (<MappingRow key={k} original={k} value={mapCentros[k]} options={sistemaData.centros} onChange={(v:string)=>setMapCentros(p=>({...p,[k]:String(v)}))} onCreate={()=>openCreateModal('CENTRO', k)} typeLabel="Centro" icon={Layers} />))}</div>
                </div>

                <div className="flex justify-between pt-6 border-t border-slate-200 dark:border-slate-800"><button onClick={()=>setStep(2)} className="px-6 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold transition">Voltar</button><button onClick={()=>setStep(4)} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg flex gap-2 items-center hover:scale-105 active:scale-95 transition">Revisar prévia <ArrowRight className="w-4 h-4"/></button></div>
            </div>
        )}

        {/* STEP 4: VALIDAÇÃO FINAL */}
        {step === 4 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Validação final da importação</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400">Revise as linhas finais antes de confirmar. Ao chegar no final da tabela, mais 200 registros são liberados automaticamente.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                            Exibindo {visiblePreviewRows.length} de {previewResolvedRows.length} linhas
                        </span>
                        {hasMorePreviewRows ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                Role até o fim para carregar mais 200
                            </span>
                        ) : null}
                    </div>
                </div>

                {previewResolvedRows.length > 0 ? (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                        <div onScroll={handlePreviewScroll} className="overflow-x-auto max-h-130 custom-scrollbar">
                            <table className="w-full min-w-275 text-sm">
                                <thead className="bg-slate-50 dark:bg-slate-900/70 text-slate-500 dark:text-slate-400">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.16em]">Linha</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.16em]">Descrição</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.16em]">Tipo</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.16em]">Valor</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.16em]">Vencimento</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.16em]">Categoria final</th>
                                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.16em]">Interessado final</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {visiblePreviewRows.map((row) => (
                                        <tr key={`${row.linha}-${row.descricao}`} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                                            <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{row.linha}</td>
                                            <td className="px-4 py-3 min-w-70">
                                                <div className="font-semibold text-slate-800 dark:text-slate-100">{row.descricao || '-'}</div>
                                                {(row.categoria_arquivo || row.entidade_arquivo) && (
                                                    <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">{row.categoria_arquivo ? `Origem cat.: ${row.categoria_arquivo}` : 'Sem categoria no arquivo'}{row.entidade_arquivo ? ` • Origem int.: ${row.entidade_arquivo}` : ''}</div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.tipo || '-'}</td>
                                            <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{row.valor || '-'}</td>
                                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.data_vencimento || '-'}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-slate-700 dark:text-slate-200">{row.categoria_final}</span>
                                                    {row.categoria_auto ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Auto</span> : null}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-slate-700 dark:text-slate-200">{row.entidade_final}</span>
                                                    {row.entidade_auto ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Auto</span> : null}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                        Nenhuma linha disponível para pré-visualização.
                    </div>
                )}

                <div className="flex justify-between pt-6 border-t border-slate-200 dark:border-slate-800"><button onClick={()=>setStep(3)} className="px-6 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold transition">Voltar</button><button onClick={handleExecutar} disabled={loading} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg flex gap-2 items-center hover:scale-105 active:scale-95 transition disabled:opacity-50">{loading && importJob?.kind === 'EXECUTE' ? <Loader2 className="animate-spin w-5 h-5"/> : <CheckCircle className="w-5 h-5"/>} {loading && importJob?.kind === 'EXECUTE' ? 'Importando...' : 'Confirmar Importação'}</button></div>
            </div>
        )}
      </div>

      {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 dark:bg-slate-900/80 backdrop-blur-sm p-4">
              <div className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-6 rounded-2xl shadow-2xl w-full animate-scale-in ${modalType === 'ENTIDADE' ? 'max-w-4xl' : 'max-w-sm'}`}>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-blue-500"/> Criar {modalType === 'ENTIDADE' ? 'Interessado' : modalType}</h3>
                  {modalType === 'ENTIDADE' ? (
                    <div className="space-y-5">
                        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                                <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
                                    <button type="button" onClick={() => setEntityForm(prev => ({ ...prev, tipo_pessoa: 'PF' }))} className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${entityForm.tipo_pessoa === 'PF' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>Pessoa Física</button>
                                    <button type="button" onClick={() => setEntityForm(prev => ({ ...prev, tipo_pessoa: 'PJ' }))} className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${entityForm.tipo_pessoa === 'PJ' ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>Pessoa Jurídica</button>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">{nomeInteressadoLabel}</label><input autoFocus type="text" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={entityForm.nome} onChange={e=>setEntityForm(prev=>({...prev, nome:e.target.value}))} /></div>
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">{documentoInteressadoLabel}</label><input type="text" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition font-mono" value={entityForm.cpf_cnpj} onChange={e=>handleEntityDocumentoChange(e.target.value)} placeholder={entityForm.tipo_pessoa === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'} /></div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-1">
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">Classificação</label><select className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={entityForm.tipo} onChange={e=>setEntityForm(prev=>({...prev, tipo:e.target.value as QuickEntityFormState['tipo']}))}><option value="CLIENTE">Cliente</option><option value="FORNECEDOR">Fornecedor</option><option value="AMBOS">Ambos</option></select></div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">Contato responsável</label><input type="text" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={entityForm.contato_nome} onChange={e=>setEntityForm(prev=>({...prev, contato_nome:e.target.value}))} /></div>
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">E-mail</label><input type="email" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={entityForm.email} onChange={e=>setEntityForm(prev=>({...prev, email:e.target.value}))} /></div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">Telefone</label><input type="text" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={entityForm.telefone} onChange={e=>setEntityForm(prev=>({...prev, telefone: formatPhone(e.target.value)}))} /></div>
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">Celular / WhatsApp</label><input type="text" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={entityForm.celular} onChange={e=>setEntityForm(prev=>({...prev, celular: formatPhone(e.target.value)}))} /></div>
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/60">
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">CEP</label><input type="text" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={entityForm.cep} onChange={e=>void handleEntityCepChange(e.target.value)} placeholder="00000-000" /></div>
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">Número</label><input type="text" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={entityForm.numero} onChange={e=>setEntityForm(prev=>({...prev, numero:e.target.value}))} /></div>
                                    <div className="flex items-end"><p className="text-[11px] text-slate-500 dark:text-slate-400">{entityCepLoading ? 'Consultando CEP...' : entityCepFeedback || 'Informe CEP e número. O restante do endereço é preenchido automaticamente.'}</p></div>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="sm:col-span-3"><label className="text-xs font-bold text-slate-500 uppercase">Logradouro</label><input readOnly type="text" className="w-full p-3 bg-slate-100 dark:bg-slate-950/60 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white mt-1 outline-none" value={entityForm.logradouro} placeholder="Preenchido automaticamente pelo CEP" /></div>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">Bairro</label><input readOnly type="text" className="w-full p-3 bg-slate-100 dark:bg-slate-950/60 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white mt-1 outline-none" value={entityForm.bairro} placeholder="Auto" /></div>
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">Cidade</label><input readOnly type="text" className="w-full p-3 bg-slate-100 dark:bg-slate-950/60 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white mt-1 outline-none" value={entityForm.cidade} placeholder="Auto" /></div>
                                    <div><label className="text-xs font-bold text-slate-500 uppercase">UF</label><input readOnly type="text" className="w-full p-3 uppercase bg-slate-100 dark:bg-slate-950/60 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white mt-1 outline-none" value={entityForm.uf} placeholder="UF" /></div>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end mt-4"><button onClick={()=>{ setModalOpen(false); setEntityForm(initialQuickEntityForm); }} className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg font-bold transition">Cancelar</button><button onClick={handleQuickCreate} disabled={loading} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex gap-2 items-center transition shadow-lg">{loading ? <Loader2 className="animate-spin w-4 h-4"/> : 'Criar interessado'}</button></div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                        <div><label className="text-xs font-bold text-slate-500 uppercase">Nome</label><input autoFocus type="text" className="w-full p-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-800 dark:text-white mt-1 outline-none focus:border-blue-500 transition" value={modalValue} onChange={e=>setModalValue(e.target.value)} /></div>
                        <div className="flex gap-2 justify-end mt-4"><button onClick={()=>setModalOpen(false)} className="px-4 py-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg font-bold transition">Cancelar</button><button onClick={handleQuickCreate} disabled={loading} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex gap-2 items-center transition shadow-lg">{loading ? <Loader2 className="animate-spin w-4 h-4"/> : 'Criar'}</button></div>
                    </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
}