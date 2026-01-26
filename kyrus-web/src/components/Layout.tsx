import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 font-sans text-slate-800 dark:text-slate-200">
      <Sidebar />
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* 'Outlet' é onde a página (Home, Dashboard) vai aparecer */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}