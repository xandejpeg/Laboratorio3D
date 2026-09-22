# Teste mecânico local sem modelo

Ensaio executado em 22/09/2026 às 13:21:08 UTC, com a fixture pública sintética `lab3d/tests/fixtures/mechanical-bracket.scad`. É um suporte em L com dois furos na base e dois na placa vertical. Suas dimensões são valores deliberados de teste, não medições de qualquer personagem.

O teste usa as funções reais `compileScad`, `renderAOViews` e `compileCustom` do Procedura. Não houve planejamento por LLM, geração de código por LLM, crítica visual automática, refino ou chamada paga. Portanto este resultado é uma validação do runtime, não uma nota de qualidade da geração automática.

| Item | Medição |
| --- | --- |
| Plataforma | Windows x64 |
| Bun | 1.3.8 |
| OpenSCAD | 2026.09.18 / Manifold |
| Blender | 5.2.1 LTS / Cycles em CPU |
| Compilação inicial | 341 ms, exit code 0 |
| Geometria inicial | 812 triângulos; caixa 40 × 24 × 30 unidades SCAD |
| STL / OBJ | 40.684 / 21.920 bytes |
| Render | 4 PNGs: frente, direita, costas, isométrica |
| Configuração do render | 384 × 384, 16 samples, 4 AO samples |
| Duração das quatro vistas | 21.164 ms |
| Primeira recompilação de parâmetro | 284 ms |
| Ensaio completo | 22.747 ms |
| Chamadas/tokens/custo de modelo | 0 / 0 / US$ 0 |
| Pico RAM/VRAM | não medido |

A recompilação mudou a largura para 52; uma mudança subsequente da fonte mudou a altura para 34. A malha resultante confirmou caixa 52 × 24 × 34. A repetição idêntica reutilizou o cache; mudar a fonte invalidou o resultado antigo. Uma fonte com erro de sintaxe foi rejeitada sem reaproveitar o STL válido anterior.

As quatro imagens foram inspecionadas: a vista isométrica mostra o suporte completo e seus quatro furos; frente/costas mostram os furos verticais e o perfil corresponde ao L. Não foram observadas peças omitidas nesta fixture. Esta inspeção é manual e limitada à geometria sintética descrita.

O teste também foi executado em um diretório com espaços. A suíte `runtime.test.ts` verificou a seleção da credencial conforme o transporte, remoção de informações sensíveis do endpoint, prioridade de overrides de executável e encerramento de um worker com seu processo filho no Windows.

Uma verificação adicional executou os renderizadores AO com cores, cores por peça e PBR, usando a mesma geometria, uma vista isométrica de 256 × 256 e 4 samples em CPU. Os três produziram PNGs válidos. O PBR foi inspecionado e mantém o suporte e seus quatro furos; essa configuração pequena serve para testar execução, sem medir qualidade final de material.

Para reproduzir:

```powershell
bun run lab3d/scripts/smoke-runtime.ts
```

O script gera `report.json`, SCAD, STL, OBJ e imagens em uma pasta ignorada pelo Git. A fonte desta medição tem SHA-256 `978fcafe1e8859421b8c19cde80b8c64d17ad30e5e9b124204cb692003f6ca4a`.

Após um ensaio bem sucedido, também publica `final.scad`, `final.stl`, `final.obj`, `prompt_input.txt` e os metadados `lab3d-execution.json`/`lab3d-completion.json`, reconhecidos pelo laboratório como `offline-compile`, sem personagem associado ou geração por IA. O destino padrão continua sendo `outputs/runtime-smoke/<data>/`; uma nova execução local foi preparada em `outputs/quality-mechanical/` para inspeção pela interface. Não é criado veredito ou resumo de aprovação visual.

```powershell
bun run lab3d/scripts/smoke-runtime.ts outputs/quality-mechanical
```

A comparação de qualidade entre personagem humana e objeto mecânico **gerados pelo modelo** continua pendente de provedor, modelo e orçamento autorizado. Não há evidência neste ensaio de rig deformável, UVs, adequação para jogos ou fidelidade humana.
