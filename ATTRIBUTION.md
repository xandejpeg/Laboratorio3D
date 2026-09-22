# Atribuição e origem

O **Laboratorio3D** é fundado no **[Procedura](https://github.com/SpatiaOS/Procedura)**, da SpatiaOS.

| Item | Registro |
| --- | --- |
| Upstream | `https://github.com/SpatiaOS/Procedura.git` |
| Origin | `https://github.com/xandejpeg/Laboratorio3D.git` |
| Commit upstream utilizado | `fac191ed49f55fcc2e0f23897e986042249f59fe` |
| Licença | MIT, preservada sem alterações em [LICENSE](LICENSE) |
| Histórico | Ancestral upstream completo, seguido por commits próprios do laboratório |

A versão inicial encontrada nesta continuidade era `fd3faf6`, já derivada do commit acima. Não houve reimportação, substituição desse trabalho ou force push.

O [README upstream original](https://github.com/SpatiaOS/Procedura/blob/fac191ed49f55fcc2e0f23897e986042249f59fe/README.md) permanece na história. A apresentação original continua abaixo da introdução ao laboratório no README atual.

## Reutilização e adaptações

O laboratório importa a fila `web/server/jobs.ts`, scanner `scan.ts`, customizador `customize.ts`, tipos e guardas do Studio. Geração usa o subprocesso real `bun run scripts/procedura.ts`; OpenSCAD produz a geometria e Blender renderiza por scripts Python.

As primeiras adaptações viviam somente em `lab3d/`. Esta continuidade corrige também arquivos upstream, em commits próprios:

- `src/runtime/`: descoberta Windows/Linux e encerramento de workers.
- `src/scad/compile.ts` e `src/render/*.ts`: caminhos Windows, subprocessos e falhas reais.
- `web/server/customize.ts`: cache dependente da fonte, publicação após sucesso e timeout.
- `web/server/jobs.ts`: diretórios reservados na fila, logs persistidos, cancelamento e opções efetivas.
- `web/shared/types.ts`: opção de exportar STL.

O frontend do laboratório adiciona contrato, revisão de referência, histórico por personagem e resultados independentes. Seu Three.js é um **visualizador de OBJ/MTL/STL**, não um construtor manual de personagens.

## Atualizações upstream

`git fetch upstream` e revisão de `git log HEAD..upstream/main` permitem avaliar novidades. Integre por merge ou commits revisados, conservando ambos os históricos. Alterações nos arquivos acima podem exigir resolução de conflitos e repetição dos testes; não se promete merge automático.

O uso local e os limites validados estão em [lab3d/README.md](lab3d/README.md). As dependências mantêm suas próprias licenças.
