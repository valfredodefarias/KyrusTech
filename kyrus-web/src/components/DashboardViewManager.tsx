import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  LayoutGrid,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';

export interface DashboardViewManagerWidget {
  id: string;
  visible: boolean;
  size: 'sm' | 'md' | 'lg' | 'full';
}

export interface DashboardViewManagerView {
  id: string;
  name: string;
  widgets: DashboardViewManagerWidget[];
}

interface DashboardViewManagerProps {
  activeDashboardViewId: string;
  activeDashboardView: DashboardViewManagerView | null;
  activeDashboardWidgets: DashboardViewManagerWidget[];
  dashboardEditMode: boolean;
  dashboardViews: DashboardViewManagerView[];
  dashboardWidgetLabels: Record<string, string>;
  onActiveViewChange: (viewId: string) => void;
  onCreateView: () => void;
  onDeleteView: () => void;
  onMoveWidget: (widgetId: string, direction: -1 | 1) => void;
  onRenameView: (name: string) => void;
  onResetView: () => void;
  onReorderWidget: (draggedWidgetId: string, targetWidgetId: string) => void;
  onToggleEditMode: () => void;
  onUpdateWidget: (widgetId: string, patch: Partial<DashboardViewManagerWidget>) => void;
}

export function DashboardViewManager({
  activeDashboardView,
  activeDashboardViewId,
  activeDashboardWidgets,
  dashboardEditMode,
  dashboardViews,
  dashboardWidgetLabels,
  onActiveViewChange,
  onCreateView,
  onDeleteView,
  onMoveWidget,
  onRenameView,
  onResetView,
  onReorderWidget,
  onToggleEditMode,
  onUpdateWidget,
}: DashboardViewManagerProps) {
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            <LayoutGrid className="h-3.5 w-3.5" />
            Vistas do dashboard
          </div>
          <h3 className="mt-3 text-xl font-bold text-slate-900 dark:text-white">Controle de visibilidade, tamanho e ordem</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-300">As vistas agora sao compartilhadas por empresa. O editor permite reorganizar os paineis por drag and drop real sem quebrar os filtros cruzados.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleEditMode}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-bold transition ${dashboardEditMode ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-500/10 dark:text-sky-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/40'}`}
          >
            <Settings2 className="h-4 w-4" />
            {dashboardEditMode ? 'Fechar editor' : 'Editar vista'}
          </button>
          <button
            type="button"
            onClick={onCreateView}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700/40"
          >
            <Plus className="h-4 w-4" />
            Nova vista
          </button>
          <button
            type="button"
            onClick={onResetView}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700/40"
          >
            <RefreshCw className="h-4 w-4" />
            Restaurar padrao
          </button>
          <button
            type="button"
            onClick={onDeleteView}
            className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-4 py-2 text-sm font-bold text-rose-600 transition hover:bg-rose-50 dark:border-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
          >
            <Trash2 className="h-4 w-4" />
            Excluir vista
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Vista ativa</label>
          <select
            value={activeDashboardViewId}
            onChange={(e) => onActiveViewChange(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
          >
            {dashboardViews.map((view) => (
              <option key={view.id} value={view.id}>{view.name}</option>
            ))}
          </select>
          <label className="block text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Nome da vista</label>
          <input
            value={activeDashboardView?.name || ''}
            onChange={(e) => onRenameView(e.target.value || 'Vista')}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
            placeholder="Nome da vista"
          />
          <p className="text-xs text-slate-400">As mudancas desta lista sao sincronizadas para todos os usuarios da mesma empresa.</p>
        </div>

        {dashboardEditMode && (
          <div className="max-h-112 overflow-auto rounded-2xl border border-slate-200 dark:border-slate-700">
            <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_auto] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:border-slate-700 dark:bg-slate-900/50">
              <span>Painel</span>
              <span>Visivel</span>
              <span>Tamanho</span>
              <span>Ordem</span>
            </div>
            {activeDashboardWidgets.map((widget, index) => (
              <div
                key={`editor-${widget.id}`}
                draggable
                onDragStart={(event) => {
                  setDraggedWidgetId(widget.id);
                  event.dataTransfer.effectAllowed = 'move';
                  const ghost = document.createElement('div');
                  ghost.innerText = dashboardWidgetLabels[widget.id] || widget.id;
                  ghost.style.background = '#0f172a';
                  ghost.style.color = '#fff';
                  ghost.style.padding = '8px 12px';
                  ghost.style.borderRadius = '12px';
                  ghost.style.position = 'absolute';
                  ghost.style.top = '-1000px';
                  document.body.appendChild(ghost);
                  event.dataTransfer.setDragImage(ghost, 0, 0);
                  setTimeout(() => document.body.removeChild(ghost), 0);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!draggedWidgetId || draggedWidgetId === widget.id) return;
                  onReorderWidget(draggedWidgetId, widget.id);
                  setDraggedWidgetId(null);
                }}
                onDragEnd={() => setDraggedWidgetId(null)}
                className={`grid grid-cols-[minmax(0,1fr)_110px_110px_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 dark:border-slate-800 ${draggedWidgetId === widget.id ? 'opacity-50' : ''}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{dashboardWidgetLabels[widget.id] || widget.id}</p>
                  <p className="text-xs text-slate-400">Posicao {index + 1} • arraste para mover</p>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateWidget(widget.id, { visible: !widget.visible })}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${widget.visible ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300'}`}
                >
                  {widget.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {widget.visible ? 'Sim' : 'Nao'}
                </button>
                <select
                  value={widget.size}
                  onChange={(e) => onUpdateWidget(widget.id, { size: e.target.value as DashboardViewManagerWidget['size'] })}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100"
                >
                  <option value="sm">Pequeno</option>
                  <option value="md">Medio</option>
                  <option value="lg">Largo</option>
                  <option value="full">Tela inteira</option>
                </select>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onMoveWidget(widget.id, -1)}
                    disabled={index === 0}
                    className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/40"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveWidget(widget.id, 1)}
                    disabled={index === activeDashboardWidgets.length - 1}
                    className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/40"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}