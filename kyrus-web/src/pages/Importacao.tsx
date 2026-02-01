import { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { useLookupStore } from '../store/lookupStore';
import { 
    UploadCloud, ArrowRight, CheckCircle, AlertTriangle, 
    FileSpreadsheet, Save, Loader2, Download,
    Plus, Check, X, Wallet, Users, Layers, Tag, 
    TrendingUp, TrendingDown, Edit2, Trash2, ChevronDown, ChevronRight,
    Wand2, GripVertical 
} from 'lucide-react';

// --- INTERFACES ---
interface ItemSistema { 
    id: number; 
    nome: string; 
    tipo?: string; 
    codigo?: string; 
    conta_pai_id?: number | null; 
    children?: ItemSistema[];     
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

// --- HELPER COMPONENTS ---

const StepBadge = ({ num, current, label }: { num: number, current: number, label: string }) => {
    const active = num === current;
    const done = num < current;
    return (
        <div className={`flex items-center gap-2 ${active ? 'text-white' : done ? 'text-emerald-500' : 'text-slate-500'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                ${active ? 'border-blue-500 bg-blue-500 text-white' : done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-600 bg-slate-800'}`}>
                {done ? <Check className="w-4 h-4"/> : num}
            </div>
            <span className="text-sm font-bold hidden sm:block">{label}</span>
            {num < 4 && <div className={`h-0.5 w-8 ${done ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>}
        </div>
    );
};

const SearchableSelect = ({ value, options, onChange, placeholder = "Selecione..." }: any) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);
    const selectedItem = options.find((opt: any) => String(opt.id) === String(value));

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
        if (selectedItem) setSearch(selectedItem.nome);
        else setSearch('');
    }, [selectedItem, isOpen]);

    const filteredOptions = options.filter((opt: any) => 
        (opt.nome || '').toLowerCase().includes(search.toLowerCase()) ||
        (opt.codigo || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <div 
                className={`flex items-center justify-between w-full p-3 rounded-lg border bg-slate-800 text-white text-sm cursor-pointer transition
                ${isOpen ? 'ring-2 ring-blue-500 border-transparent' : !value ? 'border-red-500/30' : 'border-slate-600 hover:border-slate-500'}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                {isOpen ? (
                    <input 
                        autoFocus
                        className="bg-transparent outline-none w-full text-white placeholder-slate-500"
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
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}/>
            </div>

            {isOpen && (
                <div className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95">
                    {filteredOptions.length === 0 ? (
                        <div className="p-3 text-slate-500 text-center text-xs italic">Nenhum item encontrado.</div>
                    ) : (
                        filteredOptions.map((opt: any) => (
                            <div 
                                key={opt.id}
                                className={`p-3 text-sm cursor-pointer hover:bg-blue-600 hover:text-white transition flex justify-between items-center
                                    ${String(opt.id) === String(value) ? 'bg-blue-500/20 text-blue-200' : 'text-slate-300'}`}
                                onClick={() => { onChange(opt.id); setIsOpen(false); setSearch(opt.nome); }}
                            >
                                <span>{opt.codigo ? <span className="font-mono opacity-70 mr-2">{opt.codigo}</span> : ''}{opt.nome}</span>
                                {String(opt.id) === String(value) && <Check className="w-4 h-4"/>}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

// --- ÁRVORE DRAGGABLE ---

const DraggableTreeItem = ({ item, depth = 0, onDragStart, onDrop, onEdit, onDelete, onToggle, expandedIds }: any) => {
    const isExpanded = expandedIds.has(item.id);
    const hasChildren = item.children && item.children.length > 0;

    return (
        <div className="select-none">
            <div 
                draggable
                onDragStart={(e) => onDragStart(e, item)}
                onDragOver={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation();
                    e.currentTarget.style.backgroundColor = '#1e293b'; 
                    e.currentTarget.style.borderColor = '#3b82f6';
                }} 
                onDragLeave={(e) => { 
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = 'rgba(51, 65, 85, 0.5)'; 
                }} 
                onDrop={(e) => { 
                    e.preventDefault(); 
                    e.stopPropagation(); 
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.borderColor = 'rgba(51, 65, 85, 0.5)';
                    onDrop(item.id); 
                }}
                className={`group relative flex items-center p-2 mb-1 bg-slate-800 border border-slate-700/50 rounded-lg hover:border-slate-600 transition-all`}
                style={{ marginLeft: `${depth * 20}px` }}
            >
                {/* Handle */}
                <div className="cursor-grab p-1 text-slate-600 hover:text-slate-400 mr-1">
                    <GripVertical size={14} />
                </div>

                {/* Toggle */}
                <button onClick={(e) => { e.stopPropagation(); onToggle(item.id); }} className="p-1 mr-1 text-slate-500 hover:text-white w-6 flex justify-center">
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
                    <span className="text-sm font-medium text-slate-200 truncate">{item.nome}</span>
                </div>

                {/* Actions */}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-slate-700 rounded"><Edit2 size={12}/></button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded"><Trash2 size={12}/></button>
                </div>
            </div>

            {/* Render Children Recursively */}
            {isExpanded && hasChildren && (
                <div className="relative">
                    <div className="absolute left-2.75 top-0 bottom-2 w-px bg-slate-700/50" style={{ left: `${(depth * 20) + 11}px` }}></div>
                    {item.children.map((child: any) => (
                        <DraggableTreeItem 
                            key={child.id} 
                            item={child} 
                            depth={depth + 1} 
                            onDragStart={onDragStart}
                            onDrop={onDrop}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            onToggle={onToggle}
                            expandedIds={expandedIds}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// --- PLANO CONTAS MANAGER (COM RECALCULO AUTOMÁTICO) ---
export const PlanoContasManager = ({ categorias, onUpdateList }: { categorias: ItemSistema[], onUpdateList: (l: any) => void }) => {
    const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
  const [localList, setLocalList] = useState<ItemSistema[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [draggedItem, setDraggedItem] = useState<ItemSistema | null>(null);

  // CRUD States
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'CREATE'|'EDIT'>('CREATE');
  const [formData, setFormData] = useState({ id: 0, nome: '', codigo: '', tipo: 'D' });

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
      const receitas = roots.filter(r => r.tipo === 'R' || r.tipo === 'RECEITA');
      traverseAndCode(receitas, '1');

      // 4. Aplica nas Despesas (Prefixo 2)
      const despesas = roots.filter(r => r.tipo === 'D' || r.tipo === 'DESPESA');
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

  // Inicializa e já recalcula se tiver S/N
  useEffect(() => {
    // Ordena inicialmente por código existente para manter estabilidade
    const sorted = [...categorias].sort((a,b) => (a.codigo||'z').localeCompare(b.codigo||'z', undefined, {numeric:true}));
    
    // Se houver muitos itens "S/N", podemos forçar um recálculo inicial visual
    // Mas para não marcar como "Alterado" logo de cara, apenas setamos.
    // Se quiser corrigir visualmente na hora, chame recalcCodes aqui.
    const calculated = recalcCodes(sorted); 
    setLocalList(calculated);

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
  const receitasTree = roots.filter(c => (c.tipo === 'R' || c.tipo === 'RECEITA'));
  const despesasTree = roots.filter(c => (c.tipo === 'D' || c.tipo === 'DESPESA'));

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
          item.tipo = 'RECEITA';
          newList.unshift(item); // Adiciona no topo das receitas
      } else if (targetId === 'ROOT_D') {
          item.conta_pai_id = null;
          item.tipo = 'DESPESA';
          newList.push(item); // Adiciona no fim das despesas
      } else {
          item.conta_pai_id = targetId;
          const parent = localList.find(i => i.id === targetId);
          if (parent) item.tipo = parent.tipo;
          
          // Lógica simples: adiciona ao final da lista para ser reprocessado pelo recalcCodes
          // O recalcCodes vai colocar ele como filho do targetId corretamente na árvore
          newList.push(item);
          setExpandedIds(prev => new Set(prev).add(targetId));
      }

      // 3. MÁGICA: Recalcula todos os códigos baseados na nova estrutura
      const reindexedList = recalcCodes(newList);

      setLocalList(reindexedList);
      setHasChanges(true);
      setDraggedItem(null);
  };

  // --- SAVE ---
  const handleSaveOrder = async () => {
    setSaving(true);
    try {
        const payload = localList.map((item) => ({
            id: item.id,
            codigo: item.codigo, 
            conta_pai_id: item.conta_pai_id,
            tipo: item.tipo
        }));

        await api.post('/plano-contas/reordenar', payload);
        
        setHasChanges(false);
        alert("Ordem salva com sucesso!");
        
        const updated = await fetchPlanoContas(true);
        onUpdateList(updated);

    } catch (e) {
        console.error(e);
        alert("Erro ao salvar ordem.");
    } finally {
        setSaving(false);
    }
  };

  const handleToggle = (id: number) => {
      const newSet = new Set(expandedIds);
      if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
      setExpandedIds(newSet);
  };

  const handleDelete = async (id: number) => {
      if(!confirm("Excluir categoria?")) return;
      try {
          await api.delete(`/plano-contas/${id}`);
          onUpdateList(localList.filter(c => c.id !== id));
      } catch(e) { alert("Erro ao excluir."); }
  };

  const handleSaveModal = async () => {
      try {
          if (modalMode === 'CREATE') {
              const res = await api.post('/plano-contas/', { nome: formData.nome, tipo: formData.tipo, permite_lancamentos: true });
              // Adiciona e recalcula
              const newList = [...localList, res.data];
              const reindexed = recalcCodes(newList);
              setLocalList(reindexed);
              setHasChanges(true); // Marca como alterado para forçar salvar a ordem nova
          } else {
              await api.patch(`/plano-contas/${formData.id}`, { nome: formData.nome, codigo: formData.codigo });
              onUpdateList(localList.map(c => c.id === formData.id ? {...c, nome: formData.nome, codigo: formData.codigo} : c));
          }
          setModalOpen(false);
      } catch(e) { alert("Erro ao salvar"); }
  };

  return (
    <div className="relative">
      
      {/* HEADER ACTIONS */}
      <div className="flex justify-between items-center mb-6">
          <button onClick={() => { setModalMode('CREATE'); setFormData({id:0, nome:'', codigo:'', tipo:'D'}); setModalOpen(true); }} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg font-bold flex items-center gap-2 transition shadow-lg">
              <Plus className="w-4 h-4"/> Nova Categoria
          </button>

          {hasChanges && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-4">
                <span className="text-xs text-orange-400 font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> Ordem alterada</span>
                <button 
                    onClick={handleSaveOrder} 
                    disabled={saving}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow-lg transition flex items-center gap-2"
                >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin"/> : <Save className="w-3 h-3"/>}
                    Salvar Mudanças
                </button>
            </div>
          )}
      </div>

      {/* DUAS COLUNAS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* RECEITAS */}
          <div 
            className="flex flex-col bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 min-h-125"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.05)'; }}
            onDragLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'transparent'; handleDrop('ROOT_R'); }}
          >
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-700">
                  <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4"/> RECEITAS
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-500">{receitasTree.length} Raízes</span>
              </div>
              <div className="flex-1 space-y-1">
                  {receitasTree.length === 0 ? (
                      <div className="text-center py-20 text-slate-600 text-xs italic">Arraste itens para cá</div>
                  ) : (
                      receitasTree.map(item => (
                          <DraggableTreeItem 
                             key={item.id} 
                             item={item} 
                             onDragStart={handleDragStart} 
                             onDrop={handleDrop}
                             onEdit={(i:any)=>{ setModalMode('EDIT'); setFormData({id:i.id, nome:i.nome, codigo:i.codigo||'', tipo:i.tipo}); setModalOpen(true); }}
                             onDelete={handleDelete}
                             onToggle={handleToggle}
                             expandedIds={expandedIds}
                          />
                      ))
                  )}
              </div>
          </div>

          {/* DESPESAS */}
          <div 
            className="flex flex-col bg-slate-900/50 border border-slate-700/50 rounded-xl p-4 min-h-125"
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.05)'; }}
            onDragLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            onDrop={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'transparent'; handleDrop('ROOT_D'); }}
          >
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-700">
                  <h3 className="text-sm font-bold text-red-400 flex items-center gap-2">
                      <TrendingDown className="w-4 h-4"/> DESPESAS
                  </h3>
                  <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-500">{despesasTree.length} Raízes</span>
              </div>
              <div className="flex-1 space-y-1">
                  {despesasTree.length === 0 ? (
                      <div className="text-center py-20 text-slate-600 text-xs italic">Arraste itens para cá</div>
                  ) : (
                      despesasTree.map(item => (
                          <DraggableTreeItem 
                             key={item.id} 
                             item={item} 
                             onDragStart={handleDragStart} 
                             onDrop={handleDrop}
                             onEdit={(i:any)=>{ setModalMode('EDIT'); setFormData({id:i.id, nome:i.nome, codigo:i.codigo||'', tipo:i.tipo}); setModalOpen(true); }}
                             onDelete={handleDelete}
                             onToggle={handleToggle}
                             expandedIds={expandedIds}
                          />
                      ))
                  )}
              </div>
          </div>

      </div>

      {/* MODAL */}
      {modalOpen && (
          <div className="fixed inset-0 z-80 flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
              <div className="bg-slate-800 p-6 rounded-xl w-full max-w-sm border border-slate-700 shadow-2xl animate-scale-in">
                  <h3 className="font-bold text-white mb-4 text-lg">{modalMode === 'CREATE' ? 'Nova Categoria' : 'Editar Categoria'}</h3>
                  <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Nome</label>
                        <input autoFocus value={formData.nome} onChange={(e:any)=>setFormData({...formData, nome:e.target.value})} className="w-full p-3 rounded-lg border border-slate-600 bg-slate-900 text-white outline-none focus:border-blue-500" />
                      </div>
                      
                      {modalMode === 'EDIT' && (
                          <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Código (Calculado automaticamente)</label>
                            <input disabled value={formData.codigo} className="w-full p-3 rounded-lg border border-slate-700 bg-slate-900/50 text-slate-500 font-mono cursor-not-allowed" />
                          </div>
                      )}
                      
                      {modalMode === 'CREATE' && (
                          <div>
                              <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Tipo</label>
                              <select className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white" value={formData.tipo} onChange={e=>setFormData({...formData, tipo:e.target.value})}>
                                  <option value="R">Receita</option>
                                  <option value="D">Despesa</option>
                              </select>
                          </div>
                      )}
                      
                      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-700">
                          <button onClick={()=>setModalOpen(false)} className="px-4 py-2 text-slate-400 hover:bg-slate-700 rounded-lg font-bold">Cancelar</button>
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
const MappingRow = ({ label, original, value, options, onChange, onCreate, typeLabel, icon: Icon }: any) => (
    <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 flex flex-col md:flex-row gap-4 items-center animate-in fade-in group hover:border-slate-600 transition">
        <div className="flex-1 w-full min-w-0">
            <p className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1 group-hover:text-slate-400 transition">
                <FileSpreadsheet className="w-3 h-3"/> {label || 'No Arquivo'}
            </p>
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white font-mono text-sm truncate" title={original}>
                {original}
            </div>
        </div>
        <ArrowRight className="text-slate-600 hidden md:block w-5 h-5 shrink-0" />
        <div className="flex-1 w-full min-w-0">
            <div className="flex justify-between items-center mb-1">
                <p className="text-[10px] text-blue-500 uppercase font-bold flex items-center gap-1 group-hover:text-blue-400 transition">
                    <Icon className="w-3 h-3"/> No Sistema
                </p>
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
  const [bulkLoading, setBulkLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [file, setFile] = useState<File | null>(null);
  
  const [sistemaData, setSistemaData] = useState<SistemaData>({ contas: [], categorias: [], centros: [], entidades: [] });
  const [conflitos, setConflitos] = useState<Conflitos>({ contas: [], categorias: [], centros: [], entidades: [] });
  
  const [mapCategorias, setMapCategorias] = useState<Record<string, string>>({});
  const [mapContas, setMapContas] = useState<Record<string, string>>({});
  const [mapCentros, setMapCentros] = useState<Record<string, string>>({});
  const [mapEntidades, setMapEntidades] = useState<Record<string, string>>({});
    const fetchEntidadesLookup = useLookupStore((state) => state.fetchEntidadesLookup);
    const fetchPlanoContas = useLookupStore((state) => state.fetchPlanoContas);
    const setEntidadesCache = useLookupStore((state) => state.setEntidades);
    const setEntidadesLookup = useLookupStore((state) => state.setEntidadesLookup);
    const setPlanoContasCache = useLookupStore((state) => state.setPlanoContas);
  
    const [modalOpen, setModalOpen] = useState(false);
    const [modalType, setModalType] = useState<'CATEGORIA'|'ENTIDADE'|'CONTA'|'CENTRO' | null>(null);
    const [modalValue, setModalValue] = useState('');
    const [modalPendingKey, setModalPendingKey] = useState(''); 

    useEffect(() => {
        carregarDadosIniciais();
    }, []);

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

  async function handleAnalise() {
    if (!file) return;
    setLoading(true); setFeedback(null);
    const fd = new FormData(); fd.append('file', file);
    try {
      const { data } = await api.post('/lancamentos/importar/analisar', fd);
      setConflitos({ ...data.conflitos, entidades: data.conflitos.entidades || [] });
      if (data.sistema) setSistemaData(prev => ({...prev, ...data.sistema}));
      setStep(2);
    } catch (e: any) { setFeedback({ type: 'error', message: e.response?.data?.detail || "Erro ao analisar arquivo." }); } finally { setLoading(false); }
  }

  async function handleQuickCreate() {
      if(!modalValue) return;
      setLoading(true);
      try {
          let res: any; let newItem: any;
          if(modalType === 'CATEGORIA') {
              const tipo = modalValue.startsWith('1') ? 'R' : 'D';
              res = await api.post('/plano-contas/', { nome: modalValue, tipo: tipo, permite_lancamentos: true }); 
              newItem = res.data;
              setSistemaData(prev => {
                const next = [...prev.categorias, newItem];
                setPlanoContasCache(next);
                return { ...prev, categorias: next };
              });
              setMapCategorias(prev => ({...prev, [modalPendingKey]: newItem.id}));
          } else if (modalType === 'ENTIDADE') {
              res = await api.post('/entidades/', { nome: modalValue, tipo: 'AMBOS' });
              newItem = res.data;
                            setSistemaData(prev => {
                                const next = [...prev.entidades, newItem];
                                setEntidadesCache(next);
                                setEntidadesLookup(next);
                                return { ...prev, entidades: next };
                            });
              setMapEntidades(prev => ({...prev, [modalPendingKey]: newItem.id}));
          } else if (modalType === 'CONTA') {
              res = await api.post('/contas/', { nome: modalValue, tipo: 'CORRENTE' });
              newItem = res.data;
              setSistemaData(prev => ({...prev, contas: [...prev.contas, newItem]}));
              setMapContas(prev => ({...prev, [modalPendingKey]: newItem.id}));
          } else if (modalType === 'CENTRO') {
              res = await api.post('/centro-custo/', { nome: modalValue });
              newItem = res.data;
              setSistemaData(prev => ({...prev, centros: [...prev.centros, newItem]}));
              setMapCentros(prev => ({...prev, [modalPendingKey]: newItem.id}));
          }
          setModalOpen(false); setModalValue('');
      } catch(e) { alert("Erro ao criar item."); } finally { setLoading(false); }
  }

  async function handleBulkCreate(type: 'CATEGORIA' | 'ENTIDADE' | 'CONTA' | 'CENTRO') {
      const missingList = type === 'CATEGORIA' ? conflitos.categorias.filter(k => !mapCategorias[k]) :
                          type === 'ENTIDADE' ? conflitos.entidades.filter(k => !mapEntidades[k]) :
                          type === 'CONTA' ? conflitos.contas.filter(k => !mapContas[k]) :
                          conflitos.centros.filter(k => !mapCentros[k]);
      
      if (missingList.length === 0) return;
      setBulkLoading(type);

      try {
          const promises = missingList.map(name => {
              if (type === 'CATEGORIA') {
                  const tipo = name.trim().startsWith('1') ? 'R' : 'D';
                  return api.post('/plano-contas/', { nome: name, tipo, permite_lancamentos: true }).then(r => ({ name, data: r.data }));
              }
              if (type === 'ENTIDADE') return api.post('/entidades/', { nome: name, tipo: 'AMBOS' }).then(r => ({ name, data: r.data }));
              if (type === 'CONTA') return api.post('/contas/', { nome: name, tipo: 'CORRENTE' }).then(r => ({ name, data: r.data }));
              if (type === 'CENTRO') return api.post('/centro-custo/', { nome: name }).then(r => ({ name, data: r.data }));
              return Promise.resolve(null);
          });

          const results = await Promise.all(promises);

          results.forEach((res: any) => {
              if (!res) return;
              if (type === 'CATEGORIA') {
                                    setSistemaData(prev => {
                                        const next = [...prev.categorias, res.data];
                                        setPlanoContasCache(next);
                                        return { ...prev, categorias: next };
                                    });
                  setMapCategorias(prev => ({ ...prev, [res.name]: res.data.id }));
              } else if (type === 'ENTIDADE') {
                                    setSistemaData(prev => {
                                        const next = [...prev.entidades, res.data];
                                        setEntidadesCache(next);
                                        setEntidadesLookup(next);
                                        return { ...prev, entidades: next };
                                    });
                  setMapEntidades(prev => ({ ...prev, [res.name]: res.data.id }));
              } else if (type === 'CONTA') {
                  setSistemaData(prev => ({ ...prev, contas: [...prev.contas, res.data] }));
                  setMapContas(prev => ({ ...prev, [res.name]: res.data.id }));
              } else if (type === 'CENTRO') {
                  setSistemaData(prev => ({ ...prev, centros: [...prev.centros, res.data] }));
                  setMapCentros(prev => ({ ...prev, [res.name]: res.data.id }));
              }
          });

      } catch (e) {
          console.error(e);
          alert("Erro ao criar itens em massa.");
      } finally {
          setBulkLoading(null);
      }
  }

  function openCreateModal(type: any, excelKey: string) {
      setModalType(type); setModalPendingKey(excelKey); setModalValue(excelKey); setModalOpen(true);
  }

  async function handleExecutar() {
      setLoading(true);
      const fd = new FormData(); fd.append('file', file!);
      fd.append('mapeamento_json', JSON.stringify({ map_categorias: mapCategorias, map_contas: mapContas, map_centros: mapCentros, map_entidades: mapEntidades }));
      try {
          const res = await api.post('/lancamentos/importar/executar', fd);
          setFeedback({ type: 'success', message: `${res.data.importados} lançamentos importados com sucesso!`, details: res.data.erros });
          setStep(1); setFile(null);
      } catch(e: any) { setFeedback({ type: 'error', message: e.response?.data?.detail || "Erro na importação." }); } finally { setLoading(false); }
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 overflow-y-auto custom-scrollbar p-6 pb-32">
      <div className="max-w-5xl mx-auto w-full mb-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
            <div><h1 className="text-2xl font-bold flex items-center gap-2 text-white"><UploadCloud className="w-8 h-8 text-blue-500" />Importação Inteligente</h1><p className="text-slate-400 mt-1">Concilie dados externos com seu sistema.</p></div>
            <div className="flex items-center gap-2 bg-slate-800 p-3 rounded-xl border border-slate-700 shadow-sm">
                <StepBadge num={1} current={step} label="Upload" /><StepBadge num={2} current={step} label="Classificação" /><StepBadge num={3} current={step} label="Origem" /><StepBadge num={4} current={step} label="Conclusão" />
            </div>
        </div>
        {feedback && (
            <div className={`p-4 rounded-xl border flex items-start gap-3 mb-6 animate-in slide-in-from-top-2 ${feedback.type === 'success' ? 'bg-emerald-900/20 border-emerald-800 text-emerald-300' : 'bg-red-900/20 border-red-800 text-red-300'}`}>
                {feedback.type === 'success' ? <CheckCircle className="w-5 h-5 shrink-0"/> : <AlertTriangle className="w-5 h-5 shrink-0"/>}
                <div className="flex-1"><strong className="block text-sm">{feedback.message}</strong>{feedback.details && <ul className="mt-2 list-disc list-inside text-xs opacity-80 max-h-32 overflow-y-auto custom-scrollbar">{feedback.details.map((d,i)=><li key={i}>{d}</li>)}</ul>}</div><button onClick={()=>setFeedback(null)}><X className="w-4 h-4 hover:text-white"/></button>
            </div>
        )}
        
        {/* STEP 1: UPLOAD */}
        {step === 1 && (
            <div className="bg-slate-800 p-10 rounded-2xl border border-slate-700 flex flex-col items-center justify-center min-h-100 border-dashed relative hover:border-blue-500/50 transition-colors">
                <input type="file" accept=".xlsx,.xls" onChange={e=>setFile(e.target.files?.[0]||null)} className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" />
                <div className="text-center space-y-4 pointer-events-none">
                    <div className="w-24 h-24 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse-slow"><FileSpreadsheet className="w-12 h-12 text-blue-500"/></div>
                    {file ? (<div className="animate-in fade-in zoom-in-95"><h3 className="text-2xl font-bold text-white mb-1">{file.name}</h3><p className="text-emerald-400 font-mono text-sm">{(file.size/1024).toFixed(1)} KB • Pronto para envio</p></div>) : (<div><h3 className="text-2xl font-bold text-white mb-2">Arraste ou clique para selecionar</h3><p className="text-slate-400">Suporta arquivos Excel (.xlsx, .xls)</p></div>)}
                </div>
                <div className="mt-10 z-20 flex gap-4">
                    <button onClick={handleDownloadModelo} className="px-5 py-2.5 border border-slate-600 rounded-xl text-slate-300 hover:bg-slate-700 hover:text-white font-bold flex gap-2 items-center transition"><Download className="w-4 h-4"/> Baixar Modelo</button>
                    <button onClick={handleAnalise} disabled={!file||loading} className="px-8 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 flex gap-2 items-center disabled:opacity-50 disabled:cursor-not-allowed transition hover:scale-105 active:scale-95">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : <ArrowRight className="w-5 h-5"/>} Continuar</button>
                </div>
            </div>
        )}

        {/* STEP 2: CATEGORIAS E ENTIDADES */}
        {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8">
                
                {/* MANAGER DE CATEGORIAS */}
                <PlanoContasManager categorias={sistemaData.categorias} onUpdateList={handleCategoriesUpdate} />
                
                {/* CATEGORIAS CONFLITANTES */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Tag className="text-blue-500"/> Categorias Encontradas ({conflitos.categorias.length})</h3>
                        {conflitos.categorias.length > 0 && (
                            <button onClick={() => handleBulkCreate('CATEGORIA')} disabled={!!bulkLoading} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow transition disabled:opacity-50">
                                {bulkLoading === 'CATEGORIA' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>} Resolver Tudo
                            </button>
                        )}
                    </div>
                    {conflitos.categorias.length === 0 && <div className="p-4 bg-slate-800/50 border border-slate-800 rounded-lg text-slate-500 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Tudo certo! Todas as categorias do arquivo já existem.</div>}
                    <div className="space-y-3">{conflitos.categorias.map(k => (<MappingRow key={k} original={k} value={mapCategorias[k]} options={sistemaData.categorias} onChange={(v:string)=>setMapCategorias(p=>({...p,[k]:v}))} onCreate={()=>openCreateModal('CATEGORIA', k)} typeLabel="Categoria" icon={Tag} />))}</div>
                </div>

                {/* ENTIDADES */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Users className="text-purple-500"/> Entidades Encontradas ({conflitos.entidades.length})</h3>
                        {conflitos.entidades.length > 0 && (
                            <button onClick={() => handleBulkCreate('ENTIDADE')} disabled={!!bulkLoading} className="text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow transition disabled:opacity-50">
                                {bulkLoading === 'ENTIDADE' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>} Criar Todas
                            </button>
                        )}
                    </div>
                    {conflitos.entidades.length === 0 ? (
                        <div className="p-4 bg-slate-800/50 border border-slate-800 rounded-lg text-slate-500 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Nenhuma entidade nova detectada.</div>
                    ) : (
                        <div className="space-y-3">{conflitos.entidades.map(k => (<MappingRow key={k} original={k} value={mapEntidades[k]} options={sistemaData.entidades} onChange={(v:string)=>setMapEntidades(p=>({...p,[k]:v}))} onCreate={()=>openCreateModal('ENTIDADE', k)} typeLabel="Entidade" icon={Users} />))}</div>
                    )}
                </div>

                <div className="flex justify-between pt-6 border-t border-slate-800"><button onClick={()=>setStep(1)} className="px-6 py-3 border border-slate-600 rounded-xl text-slate-300 hover:bg-slate-800 font-bold transition">Voltar</button><button onClick={()=>setStep(3)} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg flex gap-2 items-center hover:scale-105 active:scale-95 transition">Próximo <ArrowRight className="w-4 h-4"/></button></div>
            </div>
        )}

        {/* STEP 3: CONTAS E CENTROS */}
        {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-8">
                
                {/* CONTAS */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Wallet className="text-emerald-500"/> Contas Bancárias ({conflitos.contas.length})</h3>
                        {conflitos.contas.length > 0 && (
                            <button onClick={() => handleBulkCreate('CONTA')} disabled={!!bulkLoading} className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow transition disabled:opacity-50">
                                {bulkLoading === 'CONTA' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>} Criar Todas
                            </button>
                        )}
                    </div>
                    {conflitos.contas.length === 0 && <div className="p-4 bg-slate-800/50 border border-slate-800 rounded-lg text-slate-500 text-sm flex items-center gap-2"><CheckCircle className="w-4 h-4"/> Tudo certo com as contas.</div>}
                    <div className="space-y-3">{conflitos.contas.map(k => (<MappingRow key={k} original={k} value={mapContas[k]} options={sistemaData.contas} onChange={(v:string)=>setMapContas(p=>({...p,[k]:v}))} onCreate={()=>openCreateModal('CONTA', k)} typeLabel="Conta" icon={Wallet} />))}</div>
                </div>

                {/* CENTROS */}
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-bold text-white flex items-center gap-2"><Layers className="text-orange-500"/> Centros de Custo ({conflitos.centros.length})</h3>
                        {conflitos.centros.length > 0 && (
                            <button onClick={() => handleBulkCreate('CENTRO')} disabled={!!bulkLoading} className="text-xs bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-2 shadow transition disabled:opacity-50">
                                {bulkLoading === 'CENTRO' ? <Loader2 className="w-3 h-3 animate-spin"/> : <Wand2 className="w-3 h-3"/>} Criar Todas
                            </button>
                        )}
                    </div>
                    <div className="space-y-3">{conflitos.centros.map(k => (<MappingRow key={k} original={k} value={mapCentros[k]} options={sistemaData.centros} onChange={(v:string)=>setMapCentros(p=>({...p,[k]:v}))} onCreate={()=>openCreateModal('CENTRO', k)} typeLabel="Centro" icon={Layers} />))}</div>
                </div>

                <div className="flex justify-between pt-6 border-t border-slate-800"><button onClick={()=>setStep(2)} className="px-6 py-3 border border-slate-600 rounded-xl text-slate-300 hover:bg-slate-800 font-bold transition">Voltar</button><button onClick={handleExecutar} disabled={loading} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold shadow-lg flex gap-2 items-center hover:scale-105 active:scale-95 transition disabled:opacity-50">{loading ? <Loader2 className="animate-spin w-5 h-5"/> : <CheckCircle className="w-5 h-5"/>} Confirmar Importação</button></div>
            </div>
        )}
      </div>

      {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
              <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Plus className="w-5 h-5 text-blue-500"/> Criar {modalType}</h3>
                  <div className="space-y-4">
                      <div><label className="text-xs font-bold text-slate-400 uppercase">Nome</label><input autoFocus type="text" className="w-full p-3 bg-slate-900 border border-slate-600 rounded-lg text-white mt-1 outline-none focus:border-blue-500 transition" value={modalValue} onChange={e=>setModalValue(e.target.value)} /></div>
                      <div className="flex gap-2 justify-end mt-4"><button onClick={()=>setModalOpen(false)} className="px-4 py-2 text-slate-400 hover:bg-slate-700 rounded-lg font-bold transition">Cancelar</button><button onClick={handleQuickCreate} disabled={loading} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold flex gap-2 items-center transition shadow-lg">{loading ? <Loader2 className="animate-spin w-4 h-4"/> : 'Criar'}</button></div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}