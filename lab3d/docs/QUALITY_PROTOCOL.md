# Protocolo dos primeiros ensaios de geração

Este protocolo separa infraestrutura de fidelidade. A compilação mecânica sem modelo já executada está em [MECANICO_OFFLINE.md](MECANICO_OFFLINE.md). Os dois ensaios completos por IA ainda não foram executados.

## Entradas congeladas

- Personagem: PNG + ficha exportados juntos; registrar chave de importação, SHA-256 da imagem, receita completa, versão declarada e versão observada quando diferente. O ensaio preparado usa macacão cinza e botas cinza com cadarço. A aparência do cabelo e das feições deve ser conferida na imagem específica da execução; nomes de estilos não substituem essa leitura.
- Objeto mecânico: suporte em L com dois furos na base e dois na placa vertical; dimensões só quando explicitamente especificadas. A fixture sintética de runtime é um controle geométrico separado.
- Referências rotuladas opcionais: registrar se cada imagem foi armazenada ou realmente fornecida a cada etapa. As costas e a profundidade da personagem permanecem inferidas na geração atual.

Os arquivos reais da personagem e sua chave ficam somente no registro local ignorado pelo Git. Os exemplos públicos devem continuar sintéticos.

## Configuração antes de chamar modelo

Registrar provedor/endpoint sem segredos, IDs exatos dos modelos, orçamento autorizado e mecanismo de limite, número de ciclos, pintura/contexto, binários e versões, commit upstream e commit local. Não usar o número de ciclos como garantia de teto financeiro: planejamento, tentativas por peça e reparos também consomem chamadas.

Começar pelo objeto, depois pela personagem. A mesma configuração de render e critérios explícitos tornam a comparação útil. Não criar uma nova referência por IA no lugar da PNG 2D original.

## Avaliação humana

| Critério | O que comparar | Estado atual |
| --- | --- | --- |
| Cabeça/corpo | Relação visual e silhueta; sem inventar altura real | sem malha para avaliar |
| Rosto e cabelo | Identidade, feições, contorno, volume e encaixe no crânio | sem malha para avaliar |
| Corpo | Ombros, braços, cintura, quadris e pernas; não acrescentar musculatura | sem malha para avaliar |
| Extremidades | Mãos, dedos, pés e calçados presentes e legíveis | sem malha para avaliar |
| Roupa | Macacão cinza, cobertura, silhueta, dobras e calçados da imagem | sem malha para avaliar |
| Outras vistas | Consistência entre frente, perfis e costas do volume | sem malha; regiões ocultas inferidas |
| Entrega | SCAD/OBJ/MTL/STL, materiais portáteis e escala | não verificado para humana |
| Animação | Retopologia, rig, pesos, deformação e rosto | não implementado/verificado |

Para cada item, guardar imagens lado a lado e notas observáveis. Uma nota automática `ok` ou um arquivo final não substitui a avaliação humana.

## Registro e diagnóstico

Cada geração conserva referência, briefing e opções. `lab3d-execution.json` registra entrada/configuração e `lab3d-evidence.json` congela hashes, duração disponível, erros e dados do scanner após a execução. O painel mostra também o resumo final e o log. Omissões/floaters do `parts_summary.json` pertencem ao rascunho; conferir o resultado após o refino separadamente.

Registrar tempo total, tempo por etapa quando disponível, chamadas/tokens/custo informados pelo provedor, falhas, tentativas, peças omitidas e pico de memória se medido. Ausência de contabilidade aparece como indisponível.

Se a qualidade humana falhar, localizar evidência antes de propor a alteração: plano sem peça → planejador; peça presente no plano mas não construída → geração/compilação; geometria inadequada aceita → crítica/refino; render fiel mas arquivo portátil diferente → materiais/exportação. Se os limites de CSG persistirem apesar dos critérios, documentar o caso e avaliar uma representação humana mais adequada preservando a orquestração de planejamento, avaliação e correções. Não declarar pronto para jogo ou animação sem os requisitos correspondentes.
