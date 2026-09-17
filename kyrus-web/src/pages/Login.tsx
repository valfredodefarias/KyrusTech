import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { getFirstAllowedPath } from '../utils/routeRegistry';
import { ArrowRight, Loader2, Eye, EyeOff, Sparkles, BarChart3, Coins, Laptop } from 'lucide-react';
import { PasswordResetModal } from '../components/PasswordResetModal';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setInitialized = useAuthStore((state) => state.setInitialized);
  const setUser = useAuthStore((state) => state.setUser);
  const setSessionExpiresAt = useAuthStore((state) => state.setSessionExpiresAt);
  const authenticated = useAuthStore((state) => state.authenticated);
  const initialized = useAuthStore((state) => state.initialized);
  const user = useAuthStore((state) => state.user);
  const empresa = useAuthStore((state) => state.empresa);
  const otherDeviceConnected = useAuthStore((state) => state.otherDeviceConnected);
  const setOtherDeviceConnected = useAuthStore((state) => state.setOtherDeviceConnected);
  const navigate = useNavigate();

  type LoginSessionResponse = {
    expires_in_minutes: number;
    expires_at: string;
  };

  useEffect(() => {
    if (initialized && authenticated) {
      navigate(getFirstAllowedPath(user, empresa), { replace: true });
    }
  }, [authenticated, initialized, navigate, user, empresa]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setOtherDeviceConnected(false);

    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);

      const { data: session } = await api.post<LoginSessionResponse>('/auth/login', formData, {
         headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const { data: user } = await api.get('/usuarios/me');

      setAuthenticated(true);
      setUser(user);
      setSessionExpiresAt(session.expires_at);
      setInitialized(true);
      navigate(getFirstAllowedPath(user, empresa));

    } catch (err) {
      console.error(err);
      setAuthenticated(false);
      setUser(null);
      setSessionExpiresAt(null);
      setError('E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    setLoading(true);
    setError('');
    setOtherDeviceConnected(false);

    try {
      const { data: session } = await api.post<LoginSessionResponse>('/auth/demo-login');
      const { data: user } = await api.get('/usuarios/me');

      setAuthenticated(true);
      setUser(user);
      setSessionExpiresAt(session.expires_at);
      setInitialized(true);
      navigate(getFirstAllowedPath(user, empresa));

    } catch (err) {
      console.error(err);
      setAuthenticated(false);
      setUser(null);
      setSessionExpiresAt(null);
      setError('Não foi possível iniciar o ambiente de demonstração.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 dark:bg-slate-900 font-sans overflow-hidden">
      
      {/* Lado Esquerdo - Painel de Apresentação Premium */}
      <div className="hidden md:flex md:w-1/2 bg-gradient-to-tr from-slate-950 via-slate-900 to-blue-950 text-white flex-col justify-between p-16 relative overflow-hidden">
        {/* Efeitos de Fundo Decorativos */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />

        {/* Topo Logo */}
        <div className="z-10">
          <h2 className="text-2xl font-extrabold tracking-tight">
            Kyrus<span className="text-blue-500">TECH</span>
          </h2>
        </div>

        {/* Centro - Mensagens e Features */}
        <div className="z-10 max-w-lg my-auto space-y-8">
          <div className="space-y-4">
            <span className="px-3 py-1 text-xs font-semibold bg-blue-500/20 text-blue-300 rounded-full border border-blue-500/30 inline-block">
              🚀 ERP Multi-empresa Inteligente
            </span>
            <h1 className="text-4xl lg:text-5xl font-black leading-tight tracking-tight">
              Gestão Financeira Descomplicada
            </h1>
            <p className="text-slate-300 text-base leading-relaxed">
              Controle seu caixa, acompanhe comissões de vendas, integre faturas do Asaas e concilie cartões de crédito em uma única plataforma desenvolvida para alta performance.
            </p>
          </div>

          {/* Lista de Features */}
          <div className="space-y-4 pt-4 border-t border-slate-800">
            <div className="flex items-start gap-3">
              <div className="mt-1 bg-blue-500/15 p-1 rounded text-blue-400">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-slate-100">DRE Gerencial e Fluxo de Caixa</h3>
                <p className="text-xs text-slate-400">Relatórios consolidados automáticos e previsibilidade contábil em segundos.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="mt-1 bg-blue-500/15 p-1 rounded text-blue-400">
                <Coins className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-slate-100">Conciliação de Cartões e OFX</h3>
                <p className="text-xs text-slate-400">Importação facilitada e reconciliação bancária sem erros ou duplicidade.</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="mt-1 bg-blue-500/15 p-1 rounded text-blue-400">
                <Laptop className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-slate-100">PDV e Fechamento Integrados</h3>
                <p className="text-xs text-slate-400">Registro ágil de vendas diárias e painel do consultor financeiro.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="z-10 text-xs text-slate-500">
          Copyright &copy; {new Date().getFullYear()} KyrusTECH. Todos os direitos reservados.
        </div>
      </div>

      {/* Lado Direito - Formulário de Login & Acesso Demo */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
        <div className="w-full max-w-md p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700/60 transition duration-300">
          
          {/* Logo Mobile */}
          <div className="text-center mb-8 md:mb-6">
            <h1 className="text-3xl font-extrabold text-slate-800 dark:text-white tracking-tight md:hidden">
              Kyrus<span className="text-blue-600">TECH</span>
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">
              Seja bem-vindo de volta! Acesse sua conta
            </p>
          </div>

          {otherDeviceConnected && (
            <div className="mb-5 p-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-xs space-y-1.5 animate-in slide-in-from-top-2 duration-200">
              <p className="font-bold flex items-center gap-1">
                ⚠️ Sessão encerrada
              </p>
              <p>Outro dispositivo ou navegador se conectou à sua conta neste momento. Faça login novamente.</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">E-mail corporativo</label>
              <input 
                type="email" 
                required 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition" 
                placeholder="nome@empresa.com"
              />
            </div>
            
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Senha de acesso</label>
                <button
                  type="button"
                  onClick={() => setIsResetModalOpen(true)}
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 font-semibold hover:underline transition"
                >
                  Esqueceu a senha?
                </button>
              </div>
              <div className="relative">
                <input 
                  type={showPassword ? 'text' : 'password'} 
                  required 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  className="w-full p-3 pr-11 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition" 
                  placeholder="••••••••"
                />
                <button 
                  type="button" 
                  onClick={() => setShowPassword(prev => !prev)} 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && <p className="text-center text-xs text-rose-500 font-bold bg-rose-500/10 py-2 rounded-lg border border-rose-500/20">{error}</p>}
            
            <button 
              type="submit" 
              disabled={loading} 
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg transition transform active:scale-95 flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Carregando...</> : <><ArrowRight className="w-4 h-4" /> Entrar no Sistema</>}
            </button>
          </form>

          {/* Divisor Visual */}
          <div className="relative flex py-5 items-center">
            <div className="flex-grow border-t border-slate-200 dark:border-slate-700/80"></div>
            <span className="flex-shrink mx-4 text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">ou experimente</span>
            <div className="flex-grow border-t border-slate-200 dark:border-slate-700/80"></div>
          </div>

          {/* Botão de demonstração */}
          <button 
            type="button"
            onClick={handleDemoLogin}
            disabled={loading}
            className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-xl shadow-lg hover:shadow-emerald-500/10 transition transform active:scale-95 flex justify-center items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed group"
          >
            <Sparkles className="w-4 h-4 group-hover:scale-125 transition-transform" />
            Conhecer o Sistema (Modo Demo)
          </button>
          
          <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 mt-4 leading-relaxed">
            O modo de demonstração gera um banco de dados temporário exclusivo para você testar todas as funcionalidades.
          </p>

        </div>
      </div>

      <PasswordResetModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        initialEmail={email}
        onSuccessReset={(newEmail) => {
          setEmail(newEmail);
          setPassword('');
        }}
      />
    </div>
  );
}