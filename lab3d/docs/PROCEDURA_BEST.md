# Preset completo e revisão da geração

O preset `best` do Laboratorio3D executa o CLI real do Procedura, com a imagem autoritativa do registro imutável. O backend expande as opções; marcar um controle na tela sem encaminhar a opção ao subprocesso não basta.

| Etapa | Configuração |
| --- | --- |
| Construção | Incremental, plano e revisão, sem truncar a quantidade de peças |
| Referência | PNG original do personagem, copiada para a pasta nova da execução |
| Feedback durante a construção | `--3d-feedback` |
| Encaixes | `--assembly` |
| Refinamento | Até 12 ciclos, podendo parar antes conforme o critério do Procedura |
| Materiais | `--paint` |
| Articulação | `--motion --motion-urdf`; articulação rígida, não skinning humano |
| Chamadas ao modelo | Timeout e deadline de 1.800.000 ms; não alteram automaticamente os limites dos subprocessos |

`PROCEDURA_MAX_PARTS=0` e os dois limites de LLM são aplicados somente ao job `best`. Os outros presets preservam suas escolhas. O registro da execução conserva opções, modelos por etapa e uma lista explícita de variáveis não secretas; credenciais não entram nesse registro. Os modelos continuam vindo da configuração existente, sem migração de provedor ou integração com outro aplicativo.

Abra a personagem, confira a referência, escolha o preset completo e use Gerar quando o diagnóstico do ambiente estiver configurado. Cada tentativa ganha uma pasta nova. As referências guardadas apenas para consulta continuam identificadas como não utilizadas na geração. A referência frontal não fornece certeza sobre costas e profundidade.

## Correções aplicadas após a auditoria

- A revisão do plano e o pedido de patch perderam um operador `+` duplicado que inseria `NaN` e eliminava parte da instrução.
- O parser SSE conserva evento/dados entre blocos da transmissão, incluindo separadores de linha e caracteres UTF-8 divididos. O término normal entrega os dados pendentes.
- Diagnóstico incompleto ou fora do contrato não vale como aprovação. O refinamento registra o erro.
- `NOCHANGE` não resolve um diagnóstico com problemas `HIGH`: a tentativa é rejeitada e o fluxo continua sujeito aos seus limites, sem transformar a recusa em sucesso.
- O briefing prioriza proporções da imagem, face, mãos, calçados e transição da pelve; exige comparação de vistas e declaração das regiões inferidas.

Para humanos, encaixes e exportação de movimento devem manter a silhueta, sem acrescentar dobradiças externas. O preset completo oferece as fases solicitadas, mas não garante melhor anatomia só por ativá-las. Isaac ausente deve aparecer como validação não realizada. A licença, a história do upstream e os renderizadores OpenSCAD/Blender foram preservados.

## O que os testes demonstram

Testes com respostas fixas verificam o transporte e as decisões do programa. Um ensaio offline com compilação OpenSCAD e renderização Blender reais percorreu plano, revisão, duas peças, diagnóstico, patch e nova revisão; não constitui avaliação de uma IA nem geração da personagem.

A qualidade humana só poderá ser avaliada após uma geração real, pelos critérios de [QUALITY_PROTOCOL.md](QUALITY_PROTOCOL.md). Configuração de credenciais e ambiente: [WINDOWS_SETUP.md](WINDOWS_SETUP.md). O catálogo upstream não é confirmação de disponibilidade do modelo nem cotação atual.
