# Laboratorio3D — laboratório do personagem

Recebe PNG e ficha do gerador 2D e integra sua geração ao pipeline Procedura.
Preservar identidade, proporções, cabelo, rosto, corpo e roupa é o objetivo do
ensaio de qualidade; essa fidelidade ainda não foi validada por geração humana.

O pipeline não é substituído nem imitado:

```
imagem + ficha 2D → briefing → plano de peças → módulos OpenSCAD →
compilação → render no Blender → avaliação visual → correções → exportação
```

O visualizador mostra **a geometria que o sistema produziu** — o OBJ/STL escrito
pela execução. Ao abrir um personagem, ele restaura a malha mais recente vinculada
àquela importação. Também preserva as cores por vértice exportadas no OBJ, além
dos materiais MTL; não busca texturas externas declaradas pelo arquivo.

Reconstruções locais escritas por Codex são identificadas como tal. Elas podem
usar a compilação e os renders reais do Procedura sem chamar o provedor externo;
não são apresentadas como uma execução do planejamento/refino automático por API.

## Começar

```powershell
bun install                       # na raiz do repositório
bun install --cwd lab3d
bun run lab3d/scripts/doctor.ts   # o que a máquina consegue fazer agora
bun run lab3d/server.ts           # http://127.0.0.1:8770 (somente local)
```

O instalador upstream é bash/Linux e não se aplica ao Windows. O caminho
verificado está em [WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/CONTRACT.md](docs/CONTRACT.md) | O contrato `lab3d.character-import` v1 — o que o gerador 2D deve enviar |
| [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) | Bun, OpenSCAD, Blender, credenciais e execução no Windows |
| [docs/MILESTONE_1.md](docs/MILESTONE_1.md) | O que funciona, o que está bloqueado e os limites confirmados no código |
| [docs/MECANICO_OFFLINE.md](docs/MECANICO_OFFLINE.md) | Compilação e renders mecânicos realmente executados sem modelo |
| [docs/QUALITY_PROTOCOL.md](docs/QUALITY_PROTOCOL.md) | Referência feminina fixa, critérios e registro dos ensaios por IA |
| [../ATTRIBUTION.md](../ATTRIBUTION.md) | Origem, licença e convivência com o upstream |

## Organização

| Caminho | Função |
|---|---|
| `contract/` | Tipos versionados, vocabulário 2D→visual, identidade e adaptadores |
| `src/` | Briefing, leitura de imagem, registro imutável, importação, sondagem do ambiente |
| `server.ts` | Servidor local; reutiliza os módulos upstream em vez de duplicá-los |
| `web/` | Interface (TypeScript puro + three.js) |
| `scripts/doctor.ts` | Diagnóstico do ambiente |
| `tests/` | Testes com fixtures sintéticas |

## Estado

Funciona hoje: importação, registro imutável, tradução dos IDs para descrições
visuais, briefing, interface, progresso real, visualização de execuções e
recompilação de parâmetros com OpenSCAD/Manifold.

Bloqueado hoje: **ensaio de geração de modelo novo** — faltam provedor/modelo,
credencial local e orçamento autorizado. O laboratório informa a capacidade
indisponível. Recompilação cria outro resultado e conserva o anterior; ensaios
independentes aparecem separados dos personagens.

## Privacidade

O repositório é público. Ficam fora do Git: credenciais (`.env`), uploads,
registros de personagens e resultados (tudo sob `outputs/`). Os testes
versionados usam apenas fixtures sintéticas geradas em código.
