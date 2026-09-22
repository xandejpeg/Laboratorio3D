# Atribuição e origem

Este repositório é o **Laboratorio3D** e é fundado no projeto
**[Procedura](https://github.com/SpatiaOS/Procedura)**, da SpatiaOS.

| | |
|---|---|
| Upstream | `https://github.com/SpatiaOS/Procedura.git` (remoto `upstream`) |
| Commit de referência | `fac191ed49f55fcc2e0f23897e986042249f59fe` |
| Licença | MIT, do upstream, mantida sem alteração em [LICENSE](LICENSE) |
| README original | [README.md](README.md) permanece o do Procedura, intacto |

O histórico do upstream foi preservado: este repositório parte diretamente do
commit acima, que é o próprio topo de `upstream/main`. Nossas mudanças ficam em
commits nossos, por cima dele.

## Como o laboratório convive com o upstream

- Todo o código **novo** do laboratório está em [lab3d/](lab3d/README.md).
- O servidor do laboratório **importa e reutiliza** os módulos upstream
  (`web/server/jobs.ts`, `web/server/scan.ts`, `web/server/customize.ts`,
  `web/server/safe.ts`, `web/server/env.ts`) em vez de copiá-los ou
  reimplementá-los. Toda geração é um subprocesso real
  `bun run scripts/procedura.ts`.
- Consequência prática: `git fetch upstream && git merge upstream/main` continua
  simples, porque quase não há sobreposição de arquivos.

### Correções aplicadas em arquivos do upstream

Estas são as **únicas** alterações fora de `lab3d/`. São correções de
portabilidade, não mudanças de comportamento, e valem para envio ao upstream.

| Arquivos | Correção |
|---|---|
| `src/render/{ao,parts_color,pbr}.ts`, `src/pipeline/{draft,draft-incremental,motion,paint,refine,refine-direct}.ts`, `src/tools/diagnose.ts` | Trocar `new URL(import.meta.url).pathname` por `fileURLToPath(...)` |

**Por quê:** no Windows, `URL.pathname` devolve `/C:/Users/...`, e `resolve()`
transforma isso em `C:\C:\Users\...`. O efeito era que **nenhum** script de
render do Blender e **nenhum** arquivo de prompt era encontrado — o pipeline
quebraria no meio de uma execução já cobrada. Em Linux o comportamento é
idêntico ao anterior.

## Diferenças deliberadas em relação ao Studio upstream

| Diferença | Motivo |
|---|---|
| O servidor do laboratório escuta em `127.0.0.1` | O Studio upstream escuta em `0.0.0.0` sem autenticação, expondo leitura/escrita de arquivos e execução de processos |
| Os caminhos de OpenSCAD e Blender são sondados no Windows e injetados no processo filho | O upstream só procura em `$HOME/opt`, `/usr/local/bin` e `/opt` |
| Porta separada (`8770`) | Os dois servidores podem rodar lado a lado |

Comece por [lab3d/README.md](lab3d/README.md).
