# Marco 1 — laboratório funcional e limites da validação

Data: 22/09/2026. Plataforma: Windows x64, Bun 1.3.8.

O marco entrega importação real, registro persistente, execução geométrica local, acompanhamento do pipeline Procedura, visualização e recompilação. **A geração completa por modelo e a fidelidade humana continuam sem validação**, pois não há credencial configurada nem provedor, modelo e orçamento autorizados para o ensaio.

## Base preservada

A inspeção encontrou o Laboratorio3D em `fd3faf6`, já com quatro commits próprios sobre o Procedura. Esse trabalho foi preservado. `upstream/main` continua em `fac191ed49f55fcc2e0f23897e986042249f59fe`, o mesmo commit do estudo técnico local, que foi lido junto às três auditorias. A licença MIT permanece intacta; os remotos são `origin=xandejpeg/Laboratorio3D` e `upstream=SpatiaOS/Procedura`.

O laboratório reutiliza a fila, scanner de execuções, parâmetros e compilação do Studio. O visualizador carrega OBJ/MTL ou STL real. Há adaptações pontuais no núcleo para Windows, documentadas em [ATTRIBUTION.md](../../ATTRIBUTION.md); não se presume que futuros merges serão livres de conflitos.

## Validação executada

- Instalação das dependências pelos lockfiles e verificação de tipos da raiz e do laboratório.
- Testes automatizados de contrato, integridade, fila, HTTP, isolamento de personagens e recompilação real pelo OpenSCAD. O registro de validação do commit informa a contagem final.
- Bun 1.3.8, OpenSCAD 2026.09.18/Manifold e Blender 5.2.1 LTS funcionando no Windows nativo. Isaac Sim não foi usado.
- Suporte mecânico sintético compilado em STL e OBJ com 812 triângulos, renderizado em frente, perfil direito, costas e isométrica pelo Blender/Cycles em CPU.
- Primeiro ensaio: 341 ms de compilação e 21.164 ms para quatro renders; total 22.747 ms. Repetição com publicação dos arquivos no laboratório: 253 ms de compilação, 71.612 ms de render e 73.332 ms no total. São medições locais, não promessa de latência.
- Recompilação alterou a caixa de 40 × 24 × 30 para 52 × 24 × 34; repetição idêntica reutilizou o cache, alteração da fonte invalidou o cache e fonte inválida foi rejeitada.
- Renderizadores AO com cores, cores por peça e PBR também produziram imagens válidas sem modelo.
- Um worker e seu filho foram encerrados no Windows; a fila preserva os logs após reabrir o servidor.
- PNG e ficha reais foram exportados pelo gerador 2D, importados via multipart HTTP e conferidos na interface. Nenhum código do 2D foi alterado.

O ensaio mecânico é um controle de runtime a partir de **SCAD sintético escrito manualmente**. Não valida planejamento ou autoria por IA. Seus arquivos aparecem como resultado independente, sem vínculo com personagem. Detalhes em [MECANICO_OFFLINE.md](MECANICO_OFFLINE.md).

## Referência humana preparada

A combinação fixa usa feminino, corpo Original, rosto Serena, cabelo Trançado castanho claro, olhos naturais castanhos, pele natural, sem marcas e macacão cinza. PNG frontal de 900 × 1280 e ficha mantêm os IDs reais; a altura física é `null`, como no export.

A ficha exportada não contém versão de catálogo; o adaptador conserva `generatorVersion: "unknown"`. A versão `2dc-r3` foi observada separadamente no próprio gerador. O futuro envio deve usar o contrato nativo com a versão explícita. Não acrescentamos esse dado ao JSON original.

A comparação visual identificou calçados mais robustos que os descritos no antigo prompt do macacão. O briefing agora manda conservar os calçados e detalhes efetivamente visíveis, priorizando a imagem sobre descrições de direção de arte.

**Nenhuma malha humana foi gerada.** Cabeça/corpo, rosto, implantação do cabelo, ombros, braços, cintura, quadris, pernas, mãos, pés, roupa e consistência frente/perfil/costas permanecem sem nota de qualidade 3D. Regiões ocultas continuam marcadas como inferidas. O protocolo está em [QUALITY_PROTOCOL.md](QUALITY_PROTOCOL.md).

## Correções que sustentam o marco

- O visualizador verifica o vínculo execução/personagem e descarta respostas antigas após trocar a seleção. Um ensaio independente remove explicitamente a referência 2D anterior.
- A entrada é congelada atomicamente. Hashes de receita, contrato e imagens diferenciam combinações; corrupção é recusada. Um run não pode ser reassociado a outro personagem.
- Referências adicionais ficam rotuladas como `stored`. Não reduzem a incerteza do gerador enquanto não forem conectadas às etapas do pipeline.
- A recompilação cria um novo run, registra fonte, valores efetivos, hash dos arquivos e ancestral; não sobrescreve a geração original. Edições sucessivas preservam os valores herdados.
- O resultado expõe metadados, duração disponível, erros, omissões/peças soltas **no rascunho** e resumo final separado. `quality.approval` fica em `not-reviewed`.
- Os logs são persistidos e enviados antes do status terminal ao reabrir uma execução por SSE.
- O serviço escuta apenas em loopback e recusa requisições de sites externos. Credenciais e uploads ficam fora do Git.

## Pendências concretas

1. Confirmar provedor, modelo multimodal, credencial local e teto de gasto antes das chamadas cobradas. Um modelo configurado não significa acesso comercial testado.
2. Rodar planejamento → módulos → compilação → Blender → crítica → correções → exportação para um objeto mecânico e para a personagem fixa.
3. O caminho direto de LLM upstream não persiste consumo completo. Neste marco ele aparece como indisponível, nunca como zero. O ensaio local sem modelo registra zero. O limite de ciclos não é um limite monetário; controle de gasto deve ser definido antes da execução paga.
4. Ainda não há aprovação humana persistente pela interface, rig deformável, UVs/bake completos ou exportação de personagem pronta para jogo.
5. A recompilação persistente exige SCAD autocontido. `include/use/import/surface` externos são recusados com explicação até existir snapshot das dependências.
6. Referências laterais e traseiras externas ainda não chegam ao planejamento/refino/pintura. `extraRefs` upstream gera imagens por texto e não substitui essa integração.
7. O seletor de arquivos do navegador automatizado não completou o diálogo nesta sessão. A importação multipart foi validada por HTTP real; consulta, visualização e controles foram verificados no navegador.

## Limites confirmados no código atual

| Ponto | Evidência e consequência |
| --- | --- |
| Humanoides CSG | `prompts/scad_system.md` e `scad_part_system.md` orientam módulos e primitivas. Isso permite experimentar humanos, mas não garante identidade ou anatomia fiel. |
| Articulações | `src/motion/types.ts` e `usda.ts` descrevem links rígidos e juntas; não equivalem a skinning humano. |
| OBJ/MTL | `src/mesh/obj.ts` escreve vértices/faces; materiais por peça não preservam automaticamente UVs, texturas e efeitos de `_render_pbr_blender.py`. |
| Escala | `src/mesh/normalize.ts` pode normalizar OBJ. Altura física ausente não pode ser deduzida do tamanho do arquivo. |
| Referências extras | `src/pipeline/draft-incremental.ts` gera extras por texto; `refine-direct.ts` usa a imagem principal como alvo. |
| Status | `web/server/jobs.ts` pode marcar sucesso pelo código de saída ou por existir malha. Isso não aprova qualidade; artefatos parciais e veredito são expostos separadamente. |

Dados particulares e evidências com a personagem ficam em `outputs/`, ignorados pelo Git. Fixtures versionadas são sintéticas.
