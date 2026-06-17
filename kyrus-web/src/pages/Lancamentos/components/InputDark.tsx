import { CurrencyInput } from '../../../components/CurrencyInput';

export const InputDark = (props: any) => (
  <div className="w-full">
    {props.label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{props.label}</label>}
    <input
      {...props}
      className={`w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-400 disabled:opacity-50 disabled:cursor-not-allowed ${props.className || ''}`}
    />
  </div>
);

export const CurrencyInputDark = ({ label, className = '', value, onValueChange, ...props }: any) => (
  <div className="w-full">
    {label && <label className="block text-xs font-bold text-slate-400 uppercase mb-1">{label}</label>}
    <CurrencyInput
      {...props}
      value={value}
      onValueChange={onValueChange}
      className={`w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition placeholder:text-slate-400 ${className}`}
    />
  </div>
);

export const ToggleSimNao = ({
  label,
  value,
  onChange,
  yesLabel = 'Sim',
  noLabel = 'Não',
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
  disabled?: boolean;
}) => (
  <div>
    <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-2">{label}</label>
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(true)}
        className={`py-3 rounded-lg text-sm font-bold border transition ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${
          value
            ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-900/20'
            : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
        }`}
      >
        {yesLabel}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(false)}
        className={`py-3 rounded-lg text-sm font-bold border transition ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${
          !value
            ? 'bg-rose-600 text-white border-rose-600 shadow-lg shadow-rose-900/20'
            : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
        }`}
      >
        {noLabel}
      </button>
    </div>
  </div>
);
