import re

def inject_ws(file_path, ws_hook, hook_call, use_hook):
    with open(file_path, 'r', encoding='utf-8') as f:
        text = f.read()
    
    # Import
    text = f"import {{ {ws_hook} }} from '../hooks/useConfiguracoesWebSocket';\n" + text
    
    # Call
    match = re.search(r'const \{[^\}]+\} = ' + use_hook + r'\(\);', text, flags=re.MULTILINE | re.DOTALL)
    if match:
        idx = match.end()
        text = text[:idx] + f'\n  {hook_call}' + text[idx:]
        
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(text)

inject_ws('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes/components/TabEmpresa.tsx', 'useEmpresaWebSocket', 'useEmpresaWebSocket(loadEmpresa);', 'useEmpresa')
inject_ws('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes/components/TabUsuarios.tsx', 'useUsuariosWebSocket', 'useUsuariosWebSocket(loadUser);', 'useUsuarios')
inject_ws('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes/components/TabIntegracoes.tsx', 'useIntegracoesWebSocket', 'useIntegracoesWebSocket(loadData);', 'useIntegracoes')

print('Injected WebSockets')
