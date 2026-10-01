// kyrus-web/src/pages/Developers/index.tsx
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import axios from 'axios';

import type { OpenApiSpec, ParsedEndpoint, EndpointGroup } from './types';
import { GUIDES } from './guidesData';
import { parseOpenApiSpec } from './parser';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { GuideContent } from './components/GuideContent';
import { EndpointContent } from './components/EndpointContent';
import { TryItPanel } from './components/TryItPanel';
import { SearchModal } from './components/SearchModal';

export const DevelopersPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [groups, setGroups] = useState<EndpointGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Seleção atual
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>('comece-por-aqui');
  const [selectedEndpoint, setSelectedEndpoint] = useState<ParsedEndpoint | null>(null);

  // Topbar View
  const [activeView, setActiveView] = useState<'guides' | 'reference' | 'changelog'>('guides');

  // Estado da busca e sidebar
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Credencial em memória e servidor alvo
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(() => {
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      return 'https://api.kyrustech.com.br';
    }
    return 'http://localhost:8000';
  });

  // Carrega OpenAPI Spec
  const fetchOpenApiSpec = async () => {
    try {
      setLoading(true);
      setError(null);

      // Determina URL para carregar o openapi.json público
      let url = '/api/v1/public/openapi.json';
      if (typeof window !== 'undefined' && window.location.port && window.location.port !== '8000') {
        url = 'http://localhost:8000/api/v1/public/openapi.json';
      }

      const res = await axios.get<OpenApiSpec>(url);
      setSpec(res.data);
      const parsedGroups = parseOpenApiSpec(res.data);
      setGroups(parsedGroups);

      // Sincroniza seleção com base na query string da URL
      const epParam = searchParams.get('endpoint');
      const guideParam = searchParams.get('guide');

      if (epParam) {
        let foundEp: ParsedEndpoint | null = null;
        for (const g of parsedGroups) {
          foundEp = g.endpoints.find((e) => e.id === epParam || e.summary.toLowerCase() === epParam.toLowerCase()) || null;
          if (foundEp) break;
        }
        if (foundEp) {
          setSelectedEndpoint(foundEp);
          setSelectedGuideId(null);
          setActiveView('reference');
          return;
        }
      }

      if (guideParam) {
        const foundGuide = GUIDES.find((g) => g.id === guideParam);
        if (foundGuide) {
          setSelectedGuideId(foundGuide.id);
          setSelectedEndpoint(null);
          setActiveView('guides');
          return;
        }
      }
    } catch (err: any) {
      console.error('Erro ao carregar documentação OpenAPI:', err);
      setError(
        'Não foi possível carregar a especificação OpenAPI da API. Verifique se o backend está em execução.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchOpenApiSpec();
  }, []);

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectGuide = (guideId: string) => {
    setSelectedGuideId(guideId);
    setSelectedEndpoint(null);
    setActiveView('guides');
    setSearchParams({ guide: guideId });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectEndpoint = (ep: ParsedEndpoint) => {
    setSelectedEndpoint(ep);
    setSelectedGuideId(null);
    setActiveView('reference');
    setSearchParams({ endpoint: ep.id });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectTopView = (view: 'guides' | 'reference' | 'changelog') => {
    setActiveView(view);
    if (view === 'guides') {
      handleSelectGuide('comece-por-aqui');
    } else if (view === 'reference' && groups.length > 0 && groups[0].endpoints.length > 0) {
      handleSelectEndpoint(groups[0].endpoints[0]);
    } else if (view === 'changelog') {
      setSelectedGuideId(null);
      setSelectedEndpoint(null);
    }
  };

  // Flattened endpoints para o modal de busca
  const allEndpoints = groups.flatMap((g) => g.endpoints);
  const activeGuide = GUIDES.find((g) => g.id === selectedGuideId);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 flex flex-col font-sans">
      {/* Topbar Fixa */}
      <Topbar
        onOpenSearch={() => setIsSearchOpen(true)}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        activeView={activeView}
        onSelectView={handleSelectTopView}
      />

      <div className="flex-1 flex w-full">
        {/* Sidebar Esquerda (Sticky) */}
        <Sidebar
          guides={GUIDES}
          endpointGroups={groups}
          selectedGuideId={selectedGuideId}
          selectedEndpointId={selectedEndpoint?.id || null}
          onSelectGuide={handleSelectGuide}
          onSelectEndpoint={handleSelectEndpoint}
          isOpen={isSidebarOpen}
          onCloseMobile={() => setIsSidebarOpen(false)}
        />

        {/* ÁREA DE CONTEÚDO PRINCIPAL (LAYOUT 2 OU 3 COLUNAS) */}
        <main className="flex-1 lg:ml-72 md:lg:ml-80 flex flex-col xl:flex-row min-w-0">
          {loading ? (
            <div className="flex-1 py-32 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
              <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
                Carregando Documentação Kyrus API...
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 p-8 sm:p-12 flex flex-col items-center justify-center text-center">
              <div className="p-4 bg-rose-50 dark:bg-rose-950/40 text-rose-600 rounded-2xl mb-4 border border-rose-200 dark:border-rose-900">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">Falha ao Conectar</h2>
              <p className="mt-1 text-xs text-slate-500 max-w-md">{error}</p>
              <button
                type="button"
                onClick={fetchOpenApiSpec}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 shadow-sm"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Tentar Novamente</span>
              </button>
            </div>
          ) : activeView === 'changelog' ? (
            <div className="flex-1 p-6 sm:p-10 max-w-4xl space-y-6">
              <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">Changelog da API</h1>
                <p className="text-xs text-slate-500 mt-1">Histórico de versões, novos endpoints e atualizações da plataforma.</p>
              </div>

              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                      v1.0.0
                    </span>
                    <span className="text-xs text-slate-400">Outubro de 2026</span>
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Lançamento Oficial das Chaves de API e Portal do Desenvolvedor
                  </h3>
                  <ul className="list-disc pl-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                    <li>Autenticação com Chaves de API de longa duração via cabeçalho <code className="font-mono">X-Api-Key</code>.</li>
                    <li>Contas de serviço com escopo estrito por perfil RBAC e multi-tenant.</li>
                    <li>Suporte a Idempotência nativa via cabeçalho <code className="font-mono">X-Idempotency-Key</code>.</li>
                    <li>Rate limiting inteligente: 120 requisições por minuto por chave.</li>
                    <li>Portal de documentação interativo com gerador de snippets (cURL, Node, Python, PHP, n8n) e Try It!.</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* COLUNA CENTRAL: CONTEÚDO (GUIA OU ENDPOINT) */}
              <div className="flex-1 p-6 sm:p-10 max-w-4xl min-w-0">
                {activeGuide ? (
                  <GuideContent guide={activeGuide} />
                ) : selectedEndpoint && spec ? (
                  <EndpointContent
                    endpoint={selectedEndpoint}
                    spec={spec}
                    baseUrl={baseUrl}
                  />
                ) : (
                  <div className="text-center py-20 text-slate-400 italic">
                    Selecione um guia ou endpoint na barra lateral para visualizar os detalhes.
                  </div>
                )}
              </div>

              {/* COLUNA DIREITA: TRY IT! & SNIPPETS (STICKY EM TELAS XL) */}
              {selectedEndpoint && spec ? (
                <div className="w-full xl:w-[480px] p-6 sm:p-10 xl:pl-0 shrink-0">
                  <div className="xl:sticky xl:top-24">
                    <TryItPanel
                      endpoint={selectedEndpoint}
                      spec={spec}
                      apiKey={apiKey}
                      onChangeApiKey={setApiKey}
                      baseUrl={baseUrl}
                      onChangeBaseUrl={setBaseUrl}
                    />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </main>
      </div>

      {/* Modal de Busca Rápida (Ctrl+K) */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        guides={GUIDES}
        endpoints={allEndpoints}
        onSelectGuide={handleSelectGuide}
        onSelectEndpoint={handleSelectEndpoint}
      />
    </div>
  );
};
