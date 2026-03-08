import { Suspense, lazy } from 'react';

const ApexChart = lazy(() => import('react-apexcharts'));

type AsyncApexChartProps = {
  type: 'line' | 'bar' | 'area' | 'treemap' | 'donut';
  height: number;
  series: any;
  options: any;
};

export function AsyncApexChart({ type, height, series, options }: AsyncApexChartProps) {
  return (
    <Suspense
      fallback={
        <div
          className="flex items-center justify-center rounded-2xl border border-slate-200/70 bg-slate-50/70 text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-500"
          style={{ height }}
        >
          Carregando grafico...
        </div>
      }
    >
      <ApexChart type={type} height={height} series={series} options={options} />
    </Suspense>
  );
}