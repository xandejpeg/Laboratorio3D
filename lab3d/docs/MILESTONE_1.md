# Marco 1 — o que funciona, o que está bloqueado

Data: 2026-09-22 · Máquina: Windows, Bun 1.3.8

Este relatório distingue o que foi **executado e observado** do que ainda não
pôde ser executado. Nenhuma etapa abaixo é simulada.

---

## 1. Base Procedura rastreável

- `upstream` → `https://github.com/SpatiaOS/Procedura.git`
- `origin` → `https://github.com/xandejpeg/Laboratorio3D.git`
- Commit upstream de referência: **`fac191ed49f55fcc2e0f23897e986042249f59fe`**
  (é o próprio topo de `upstream/main`; o histórico público do Procedura é um
  único commit inicial).
- A licença MIT do upstream permanece em `LICENSE`, sem alteração.
- Todo o código **novo** vive em `lab3d/`. Fora dele, a única mudança é uma
  correção de portabilidade no Windows (`fileURLToPath`), descrita em
  [ATTRIBUTION.md](../../ATTRIBUTION.md) e detalhada na seção 2. Isso mantém
  `git merge upstream/main` simples e deixa claro, por caminho de arquivo, o
  que é deles e o que é nosso.
- O laboratório **importa e reutiliza** `web/server/jobs.ts`, `scan.ts`,
  `customize.ts`, `safe.ts` e `env.ts` — não os copia nem os substitui. Toda
  geração é um subprocesso real `bun run scripts/procedura.ts`.

## 2. O que foi verificado em execução

Servidor no ar em `http://127.0.0.1:8770` (somente local), com as rotas
exercitadas por HTTP real:

| Verificação | Resultado observado |
|---|---|
| `GET /api/lab/runtime` | OpenSCAD 2026.09.18 com backend Manifold, Blender 5.2.1 LTS, LLM não configurado, `generate: false`, `recompileParams: true` |
| `POST /api/lab/import` (ficha + PNG 900×1280) | `201`, registro congelado, `reused: false` |
| Reimportar a mesma combinação | `200`, `reused: true`, mesma chave, mesmo `importedAt` |
| Importar com uma referência de costas anexada | `201`, **outra chave**, e as regiões sem referência caem de 5 para 4 |
| PNG 512×512 com ficha que declara 900×1280 | `422 front image does not match the sheet` |
| `POST /api/lab/generate` | `503 generation unavailable: no LLM credential is configured` |
| `GET /api/lab/asset?...&file=../record.json` | `404` — o caminho não escapa do registro |
| `GET /` e bundle da interface | `200`; CSS 7 kB e JS 1,47 MB (inclui three.js) servidos |

### Compilação real com OpenSCAD

Com o OpenSCAD instalado, a cadeia de compilação e recompilação foi exercitada
de ponta a ponta sobre um SCAD paramétrico (flange com furos):

| Verificação | Resultado observado |
|---|---|
| Compilação com `--backend Manifold` | STL 249 kB e OBJ 27 kB, **1.084 facetas** |
| `GET /api/params` | Os 6 parâmetros do SCAD, `customizeAvailable: true` |
| `POST /api/customize` com parâmetro inexistente | `422` — só recompila o que o SCAD declara |
| `POST /api/customize` pela interface (`bolt_count` 4 → 8) | `200` em **0,3 s**, malha passa de 1.084 para **1.356 triângulos** |

### Render no Blender

A etapa de render é independente do modelo de linguagem, então pôde ser provada
agora — sobre a malha que o OpenSCAD produziu, pelo ponto de entrada real do
pipeline (`renderAOViews`):

| Verificação | Resultado observado |
|---|---|
| Render AO + arestas Freestyle, 2 vistas, 384 px | **9,3 s**, `ao-front.png` 64 kB e `ao-isometric.png` 115 kB |
| Conteúdo das imagens | A peça compilada, sombreada e com arestas — é o que o crítico visual recebe |

Dois defeitos reais foram encontrados e corrigidos neste caminho; ambos só
apareceriam no meio de uma execução já cobrada.

**1. Caminhos de arquivo quebrados no Windows.** Dez módulos do upstream
resolviam caminhos com `new URL(import.meta.url).pathname`, que no Windows
devolve `/C:/Users/...`; `resolve()` transformava isso em `C:\C:\Users\...`.
Consequência: **nenhum** script de render do Blender e **nenhum** arquivo de
prompt era encontrado. Corrigido com `fileURLToPath`, que é equivalente em
Linux. Detalhes em [ATTRIBUTION.md](../../ATTRIBUTION.md).

**2. Render na GPU trava.** Com o padrão do pipeline (GPU ligada), o Cycles
escolhe OPTIX, anuncia o dispositivo e **trava sem produzir amostra alguma**:
mais de 4 minutos contra 9 segundos na CPU, para a mesma peça a 256 px. Cada
render de cada passo de refino morreria no timeout. Foi adicionado o
interruptor `PROCEDURA_RENDER_GPU=0`, que mantém o padrão anterior para quem
tem GPU funcional e é reportado pelo `doctor`.

### Interface em navegador real

Verificada com o navegador controlado por automação, **zero erros de console**:

- O aviso de capacidades mostra `✓ importar · ✕ gerar · ✓ recompilar · ✓ crítica
  visual` com a causa do bloqueio escrita por extenso.
- Selecionar um personagem carrega a referência 2D em 900×1280, a ficha
  traduzida, os avisos de regiões sem referência e o briefing.
- "Visualizar pronto" abre uma execução existente **sem executar nada**, e o
  visualizador desenha a malha que o OpenSCAD produziu — os 8 furos aparecem na
  tela depois da recompilação, confirmando que a geometria exibida é a do
  sistema, não um modelo montado à mão.

Suíte de testes: **37 testes, 0 falhas** (`bun test` em `lab3d/`).
Verificação de tipos: **limpa** (`tsc --noEmit`).
Todas as fixtures são sintéticas e geradas em código — nenhuma imagem privada,
nenhum export real e nenhuma credencial entram no repositório.

## 3. O que funciona hoje

- **Importação** de `2dc-ficha-*.json`, `2dc-receita.json` ou do pacote nativo
  `lab3d.character-import` v1, junto do PNG frontal e de referências rotuladas
  opcionais.
- **Registro imutável**: chave SHA-256 sobre contrato + gerador + receita +
  digests de todas as imagens + altura. Combinação repetida reaproveita o
  registro; conteúdo diferente na mesma chave é recusado com `409`.
- **Tradução dos IDs**: cada `female-outfit-0` vira "Macacão cinza" com a
  descrição visual derivada do prompt de arte original. IDs fora do vocabulário
  são **listados como desconhecidos**, nunca adivinhados.
- **Briefing honesto**: o texto enviado ao pipeline lista as regiões sem
  referência visual, calculadas a partir dos ângulos realmente presentes, e
  instrui explicitamente a não acrescentar musculatura nem afinar a figura.
- **Interface** com importação, revisão da ficha, ações separadas (gerar /
  recompilar / visualizar), progresso real por SSE com o log do processo,
  comparação lado a lado 2D × 3D, órbita e zoom, lista de arquivos exportados,
  histórico de execuções e editor dos parâmetros que o Procedura de fato expõe.
- **Compilação e recompilação** de geometria com OpenSCAD/Manifold, medida em
  frações de segundo, com a malha recarregada no visualizador.
- **Render no Blender** das vistas AO com arestas, que é a imagem consumida pela
  crítica visual.
- **Sondagem de ambiente** para Windows, que alimenta `OPENSCAD_PATH` e
  `PROCEDURA_BLENDER_PATH` no processo filho — o upstream só procura em
  `$HOME/opt`, `/usr/local/bin` e `/opt`.

Em outras palavras, a cadeia **SCAD → compilação → malha → render → imagem para
crítica** está provada nesta máquina. O que falta é exclusivamente a parte que
chama o modelo: planejamento, geração das peças e refino.

## 4. O que está bloqueado, e por quê

| Bloqueio | Consequência | Como destravar |
|---|---|---|
| **Sem credencial de LLM** | Planejamento, geração das peças e refino não podem começar; sem eles não há SCAD para compilar | [WINDOWS_SETUP.md § 4](WINDOWS_SETUP.md) |

OpenSCAD deixou de ser bloqueio: foi instalado (snapshot 2026.09.18, ZIP
portátil com SHA-256 conferido, sem elevação) e a recompilação de parâmetros
já roda pela interface.

Consequência direta: **os dois ensaios de qualidade ainda não puderam ser
executados** — nem a personagem feminina de macação cinza, nem o objeto
mecânico simples. O laboratório responde `503` com a causa em vez de exibir uma
geração fingida.

Para executá-los é preciso **confirmar provedor, modelo e orçamento
autorizado**, já que cada execução é cobrada por chamada ao modelo. A chave
deve ser escrita direto no `.env` da raiz, que está no `.gitignore`.

## 5. Limites do estudo, confirmados no código atual

Cada item abaixo foi verificado no código deste repositório, não presumido.

**1. Fidelidade humanoide via CSG/OpenSCAD é limitada.**
`prompts/scad_system.md` restringe a saída a primitivas CSG (`cube`, `sphere`,
`cylinder`, `polyhedron`, `hull`, `minkowski`, `offset`) e proíbe `import()`.
Rosto, cabelo e tecido são aproximados por união de sólidos; o próprio prompt
mede sucesso por contagem de módulos ("10–25 módulos de topo para um
humanoide"), não por semelhança de superfície. Identidade facial e caimento de
roupa não são representáveis nesse vocabulário com a fidelidade de uma escultura.

**2. Articulações rígidas não são um rig deformável.**
`src/motion/types.ts` define `MotionJointType` como `fixed | revolute |
prismatic | ...` e `MotionRigidBodyKind` como `dynamic | kinematic | static`.
Um "link" é um conjunto de módulos SCAD de topo (`MotionLinkSpec.modules`). Não
há pesos de skinning, nem malha deformável, nem blend shapes em lugar nenhum do
pipeline. Serve para simulação de corpos rígidos, não para animação de
personagem.

**3. O OBJ/MTL exportado não tem UVs.**
`src/mesh/obj.ts` documenta no cabeçalho: *"Minimal OBJ writer (vertex/face
only)"* e *"Why no normals or UVs"*. A pintura é por material aplicado a grupos
de faces, não textura mapeada. Não há coordenada de textura para levar a um
pipeline de texturização.

**4. `extraRefs` não é entrada de múltiplos ângulos.**
Em `src/pipeline/draft-incremental.ts`, `extraRefs` **gera** imagens novas com
um modelo de imagem a partir do texto (`EXTRA_REF_VIEWS` reescreve o ângulo do
prompt: front, side, rear, top). Ele não aceita fotografias ou renders externos.
Por isso o laboratório marca toda referência adicional como
`influence: "stored"`: ela é guardada, rotulada e entra na identidade, mas não
chega ao gerador — que recebe um único `--image`.

**5. `succeeded` com malha não é aprovação visual.**
`web/server/jobs.ts` marca o trabalho como `succeeded` quando o código de saída
é 0 **ou** quando qualquer malha existe (`finalReady || draftReady`), mesmo
quando o refino terminou em `give_up` ou estourou `max-steps`. A interface do
laboratório mostra o veredito real do refino ao lado do status e avisa, no
próprio painel de resultado, que a existência de malha não significa aprovação.

## 6. Dados privados fora do Git

- `outputs/` (que contém `outputs/lab3d/`, todo o registro, os uploads e os
  resultados) já está no `.gitignore` herdado do upstream.
- `.env` e `.env.*` estão ignorados; `.env.example` permanece versionado.
- Nenhum código do gerador 2D foi copiado para cá — apenas o contrato de dados
  documentado em [CONTRACT.md](CONTRACT.md).
- As fixtures de teste são geradas em código (PNG sintético construído byte a
  byte, receita sintética com a gramática real de IDs).

## 7. Próximos passos, em ordem

1. Configurar provedor/modelo e confirmar orçamento.
2. Executar o ensaio do objeto mecânico simples (baixo custo, valida a cadeia
   inteira: plano → peças → compilação → render → refino → exportação).
3. Executar o ensaio da personagem de macação cinza e comparar com a referência
   2D na tela de comparação.
4. Registrar o resultado observado — inclusive o que o CSG não conseguir
   reproduzir — antes de considerar qualquer ajuste no pipeline.
