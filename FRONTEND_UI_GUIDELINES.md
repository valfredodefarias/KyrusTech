# Frontend UI Guidelines

Este documento define a direção de interface para o frontend do Kyrus ERP.

## Objetivo

Entregar telas leves, claras e rápidas de entender. A interface deve ajudar o usuário a concluir a tarefa com o menor atrito possível.

## Regras principais

1. Evite telas pesadas ou densas por padrão.
2. Prefira progressiva divulgação de conteúdo: mostre primeiro o essencial, depois o detalhe.
3. Use cards, painéis e seleções por etapas quando houver muito conteúdo.
4. Não exponha tabelas grandes quando uma visualização em cards ou lista resumida resolver.
5. Mantenha rótulos curtos, claros e orientados à ação.
6. Use feedback visual simples e imediato para carregamento, sucesso, erro e vazio.
7. Preserve boa leitura em desktop e mobile.
8. Reduza ruído visual: menos blocos simultâneos, mais foco em uma ação principal por tela.
9. Nunca sacrificar usabilidade em nome de compactação visual.
10. Se houver muitos dados, use busca, filtro, paginação ou seleção por etapa.

## Direção de UX

- Priorizar entendimento rápido do contexto.
- Destacar a ação principal da tela.
- Evitar layouts sobrecarregados com muitas colunas, campos e botões ao mesmo tempo.
- Separar claramente: seleção, detalhe e edição.
- Usar estados vazios úteis, com instrução objetiva.
- Usar card visual para itens como perfis, usuários, entidades, contas ou integrações quando a lista ficar extensa.

## Padrões recomendados

- Cards clicáveis para escolha de item.
- Painel de detalhe ao lado ou abaixo do item selecionado.
- Tabs somente quando ajudarem a dividir o fluxo.
- Formulários com grupos pequenos e coerentes.
- Hierarquia visual forte com títulos, subtítulos e ações destacadas.
- Fallback visual para imagens ausentes, usando iniciais ou ícones.

## O que evitar

- Tabelas gigantes como primeira visão.
- Formulários longos sem quebra visual.
- Ações escondidas sem indicação clara.
- Excesso de informação simultânea.
- Componentes muito carregados sem necessidade.
- Texto técnico aparecendo quando existe uma descrição amigável disponível.

## Regra prática

Se uma tela parecer pesada, pergunte:

- O usuário precisa ver tudo de uma vez?
- Dá para mostrar um resumo e abrir o detalhe só no clique?
- Existe uma forma mais visual e direta de escolher o item?

Se a resposta for sim, simplifique a tela.
