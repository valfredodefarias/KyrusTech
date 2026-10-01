// kyrus-web/src/pages/Developers/components/Sidebar.tsx
import React, { useState } from 'react';
import {
  Search,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Rocket,
  Key,
  Server,
  AlertCircle,
  ListOrdered,
  Gauge,
  ShieldCheck,
  Workflow,
  Layers,
} from 'lucide-react';
import type { EndpointGroup, GuideItem, ParsedEndpoint } from '../types';

interface SidebarProps {
  guides: GuideItem[];
  endpointGroups: EndpointGroup[];
  selectedGuideId: string | null;
  selectedEndpointId: string | null;
  onSelectGuide: (guideId: string) => void;
  onSelectEndpoint: (endpoint: ParsedEndpoint) => void;
  isOpen: boolean;
  onCloseMobile: () => void;
}

const GUIDE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Rocket,
  Key,
  Server,
  AlertCircle,
  ListOrdered,
  Gauge,
  ShieldCheck,
  Workflow,
};

export const Sidebar: React.FC<SidebarProps> = ({
  guides,
  endpointGroups,
  selectedGuideId,
  selectedEndpointId,
  onSelectGuide,
  onSelectEndpoint,
  isOpen,
  onCloseMobile,
}) => {
  const [filterText, setFilterText] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (tag: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [tag]: !prev[tag],
    }));
  };

  const getMethodBadge = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
      case 'POST':
        return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800';
      case 'PUT':
      case 'PATCH':
        return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800';
      case 'DELETE':
        return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300';
    }
  };

  const cleanFilter = filterText.trim().toLowerCase();

  // Filtra guias
  const filteredGuides = guides.filter(
    (g) =>
      g.title.toLowerCase().includes(cleanFilter) ||
      g.summary.toLowerCase().includes(cleanFilter)
  );

  // Filtra grupos de endpoints
  const filteredGroups = endpointGroups
    .map((grp) => {
      const matchEndpoints = grp.endpoints.filter(
        (ep) =>
          ep.path.toLowerCase().includes(cleanFilter) ||
          ep.summary.toLowerCase().includes(cleanFilter) ||
          ep.method.toLowerCase().includes(cleanFilter) ||
          grp.tag.toLowerCase().includes(cleanFilter)
      );
      return {
        ...grp,
        endpoints: matchEndpoints,
      };
    })
    .filter((grp) => grp.endpoints.length > 0);

  return (
    <>
      {/* Backdrop para mobile */}
      {isOpen ? (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs lg:hidden animate-in fade-in"
        />
      ) : null}

      <aside
        className={`fixed top-16 bottom-0 left-0 z-40 w-72 md:w-80 bg-slate-50/80 dark:bg-slate-950/80 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform duration-300 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Campo de Filtro */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Filtrar guias e endpoints..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 outline-none focus:border-blue-500 transition"
            />
          </div>
        </div>

        {/* Lista com Scroll */}
        <div className="flex-1 overflow-y-auto p-3 space-y-6 text-xs custom-scrollbar">
          {/* SEÇÃO: INTRODUÇÃO & GUIAS */}
          {filteredGuides.length > 0 ? (
            <div>
              <div className="px-2.5 mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <BookOpen className="w-3 h-3" />
                <span>Introdução</span>
              </div>
              <div className="space-y-0.5">
                {filteredGuides.map((guide) => {
                  const Icon = GUIDE_ICONS[guide.iconName] || BookOpen;
                  const isSelected = selectedGuideId === guide.id;

                  return (
                    <button
                      key={guide.id}
                      type="button"
                      onClick={() => {
                        onSelectGuide(guide.id);
                        onCloseMobile();
                      }}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition ${
                        isSelected
                          ? 'bg-blue-600 text-white font-bold shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-slate-400'}`} />
                      <span className="truncate">{guide.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* SEÇÃO: RECURSOS DA API (AGRUPADOS POR TAG) */}
          {filteredGroups.length > 0 ? (
            <div className="space-y-4">
              <div className="px-2.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <Layers className="w-3 h-3" />
                <span>Recursos da API</span>
              </div>

              {filteredGroups.map((group) => {
                const isCollapsed = collapsedGroups[group.tag] && !cleanFilter;

                return (
                  <div key={group.tag} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.tag)}
                      className="w-full flex items-center justify-between px-2.5 py-1 rounded-md text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition select-none"
                    >
                      <span className="truncate">{group.tag}</span>
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </button>

                    {!isCollapsed ? (
                      <div className="pl-1 space-y-0.5 border-l border-slate-200/80 dark:border-slate-800/80 ml-2">
                        {group.endpoints.map((ep) => {
                          const isSelected = selectedEndpointId === ep.id;

                          return (
                            <button
                              key={ep.id}
                              type="button"
                              onClick={() => {
                                onSelectEndpoint(ep);
                                onCloseMobile();
                              }}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition group ${
                                isSelected
                                  ? 'bg-blue-600 text-white font-bold shadow-xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                              }`}
                            >
                              <span
                                className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-tight border shrink-0 ${
                                  isSelected
                                    ? 'bg-white/20 text-white border-white/30'
                                    : getMethodBadge(ep.method)
                                }`}
                              >
                                {ep.method}
                              </span>
                              <span className="truncate text-[11px]">{ep.summary}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {filteredGuides.length === 0 && filteredGroups.length === 0 ? (
            <div className="p-4 text-center text-slate-400 italic">
              Nenhum resultado encontrado para "{filterText}"
            </div>
          ) : null}
        </div>
      </aside>
    </>
  );
};
