# Laboratorio3D — laboratório do personagem

Recebe um personagem do gerador 2D e produz sua versão 3D pelo pipeline
Procedura, preservando identidade, proporções, cabelo, rosto, corpo e roupa.

O pipeline não é substituído nem imitado:

```
imagem + ficha 2D → briefing → plano de peças → módulos OpenSCAD →
compilação → render no Blender → avaliação visual → correções → exportação
```

O visualizador mostra **a geometria que o sistema produziu** — o OBJ/STL escrito
pela execução. Não há personagem genérico montado à mão.

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

Bloqueado hoje: **geração de modelo novo** — falta configurar uma credencial de
modelo de linguagem. O laboratório informa o bloqueio em vez de simular
progresso.

## Privacidade

O repositório é público. Ficam fora do Git: credenciais (`.env`), uploads,
registros de personagens e resultados (tudo sob `outputs/`). Os testes
versionados usam apenas fixtures sintéticas geradas em código.
