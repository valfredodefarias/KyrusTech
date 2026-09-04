import re

file_path = "c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/PDV.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace import
content = content.replace("import { useKyrusWsListener } from '../hooks/useKyrusWebSocket';", "import { usePdvWebSocket } from './PDV/hooks/usePdvWebSocket';")

# Find the block and replace
ws_start = content.find("  // WebSocket\n  useKyrusWsListener('VENDA_CREATED'")
ws_end = content.find("  // Check user", ws_start)

if ws_start > 0 and ws_end > 0:
    new_ws_call = "  // WebSocket\n  usePdvWebSocket(loadVendas, loadProdutos);\n\n"
    content = content[:ws_start] + new_ws_call + content[ws_end:]

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Injected usePdvWebSocket.")
