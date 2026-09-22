# Registrar um resultado criado no Blender

O registro recebe arquivos locais já criados e liga uma nova execução ao
snapshot 2D exato. Não executa Blender, Python, Procedura nem modelos; não
reescreve personagens, execuções anteriores ou o contrato de importação v1.

Prepare uma pasta de trabalho fora do diretório final da execução. Ela deve
conter `final.glb`, `character.blend` e um manifesto `blender-result.json`:

```json
{
  "contract": "lab3d.blender-result",
  "contractVersion": 1,
  "runId": "blender-character-revision-2",
  "characterKey": "SHA256_DO_PERSONAGEM_IMPORTADO",
  "referenceSha256": "SHA256_DA_REFERENCIA_FRONTAL_DESSE_PERSONAGEM",
  "sourceRunId": "EXECUCAO_ANTERIOR_DO_MESMO_PERSONAGEM",
  "title": "Revisão do personagem criada no Blender",
  "blenderVersion": "5.2.1",
  "coordinates": "gltf-y-up",
  "artifacts": ["final.glb", "character.blend", "build.py", "preview/front.png"],
  "limitations": ["Revisão visual pendente; rig e UV não validados."]
}
```

Substitua as chaves pelos valores reais do registro. `sourceRunId` é opcional;
quando informado, precisa pertencer ao mesmo personagem. Declare somente os
arquivos presentes. As limitações devem descrever esse resultado específico.

No checkout do Laboratorio3D:

```powershell
bun run lab3d/scripts/register-blender.ts --root "C:\caminho\Laboratorio3D\outputs" --manifest "C:\trabalho\nova-revisao\blender-result.json"
```

O CLI publica `<root>/<runId>/` depois de preparar os arquivos. Um reenvio
idêntico verifica os hashes e reutiliza a execução; conteúdo diferente exige
outro `runId`. Fontes e previews permanecem disponíveis para auditoria.

O GLB precisa ser versão 2, com geometria e imagens incorporadas. URIs externas
ou data URIs são recusadas no registro, assim como Draco, meshopt e Basis/KTX2
que exigiriam decodificadores adicionais. O arquivo `.blend` deve ter cabeçalho
Blender, salvo sem compressão de arquivo. A inspeção estrutural não equivale a
validação completa do formato nem aprovação visual. Não se infere qualidade
de anatomia, malha, material, rig ou UV a partir da importação bem sucedida.

A proveniência usa `purpose: "blender-authored"`, `backend: "blender"`, hashes
dos arquivos, hash da referência e `capabilities.recompileParams: false`.
`lab3d-completion.json` confirma o registro, não uma geração automática.
`lab3d-evidence.json` mantém revisão pendente e consumo anterior desconhecido;
o CLI não presume custo zero da criação do modelo.

O visualizador usa GLB em Y-up. Não aplique novamente a conversão Z-up→Y-up
usada para os arquivos OpenSCAD/OBJ/STL antigos. Para modificar esse resultado,
edite a fonte Blender e registre uma nova revisão; o painel OpenSCAD não pode
recompilar um GLB. Nenhuma rota HTTP de upload genérico ou execução de scripts
é adicionada por esse fluxo.
