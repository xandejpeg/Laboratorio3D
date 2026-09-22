# Envio direto do gerador 2D

O gerador e o Laboratorio3D continuam sendo projetos separados. O botão **Enviar ao Laboratorio3D** no 2D abre o laboratório e transfere uma cópia da imagem e da ficha da combinação escolhida. Não inicia geração ou chamadas a modelos.

## Uso local

1. Inicie a prévia do gerador 2D na porta 8766 com o servidor do próprio projeto.
2. Inicie o Laboratorio3D na porta 8771, conforme [WINDOWS_SETUP.md](WINDOWS_SETUP.md).
3. No gerador, escolha a combinação e clique em **Enviar ao Laboratorio3D**. Permita a janela aberta pelo botão se o navegador a bloquear.
4. Confira a referência e a ficha no laboratório. Reenviar os mesmos dados reaproveita o registro; mudanças de combinação recebem outra identidade.

O link **Abrir gerador 2D** no cabeçalho do laboratório aponta para a prévia local. O endereço de um personagem importado é `/?character=<hash>` e pode ser reaberto enquanto o servidor e os dados locais estiverem disponíveis.

## Protocolo da ponte — versão 1

A transferência usa `window.postMessage` entre a página do 2D e a janela do laboratório aberta diretamente pelo clique. Não habilita CORS para a API local. A página receptora deve ser aberta com `/?bridge=2dc` e conservar `window.opener`.

Cada janela aceita um `requestId` com 8–80 caracteres (`A–Z`, `a–z`, números, `_` ou `-`; um UUID serve). O remetente valida `event.source === popup`, `event.origin === targetOrigin` e o mesmo identificador em todas as respostas. O receptor exige a janela que o abriu e uma origem autorizada exata.

| Direção | Mensagem |
| --- | --- |
| 2D → Lab | `{type: "lab3d:hello", version: 1, requestId}` |
| Lab → 2D | `{type: "lab3d:ready", version: 1, requestId}` |
| 2D → Lab | `{type: "lab3d:import", version: 1, requestId, sheet, images}` |
| Lab → 2D | `{type: "lab3d:import-result", version: 1, requestId, ok: true, key, reused, url}` |
| Lab → 2D em erro | `{type: "lab3d:import-result", version: 1, requestId, ok: false, error}` |

O 2D repete o `hello` enquanto a janela carrega, por um prazo limitado. Depois de `ready`, envia o payload uma vez. A ponte deduplica mensagens repetidas: não dispara outra importação enquanto a primeira estiver em andamento e reenvia o recibo depois. Uma transferência nova usa outra janela. A sessão expira dois minutos após o primeiro `hello`.

`sheet` é o objeto nativo [lab3d.character-import v1](CONTRACT.md), com as versões reais da fonte. `images` é um array de `{angle, blob, note?}`; os bytes viajam em `Blob`, sem buscar URLs remotas ou interpretar caminhos do remetente. A frente é obrigatória. Outras referências só devem ser incluídas quando correspondem exatamente ao snapshot enviado; permanecem `stored` enquanto não forem conectadas ao pipeline.

Receita, ficha e PNG devem vir do **mesmo snapshot**. Alterar a seleção enquanto o PNG é preparado não pode misturar estados. O receptor transforma o payload em multipart e chama a mesma importação validada da interface. Limites: ficha 2 MiB, cada imagem 24 MiB, até seis ângulos únicos e conjunto até 95 MiB, deixando margem para o limite HTTP de 96 MiB.

## Origens autorizadas

As prévias locais autorizadas por padrão são `http://127.0.0.1:8766`, `http://127.0.0.1:8767` e as mesmas portas em `localhost`. Para um site 2D privado publicado, acrescente sua origem exata no ambiente local ou no `.env` ignorado pelo Git:

```dotenv
LAB3D_2D_ORIGINS=https://seu-gerador.exemplo
```

Origens extras são separadas por vírgula; use HTTPS ou HTTP exclusivamente em loopback. Não inclua caminho, barra final, query, credencial ou curinga. `/api/lab/bridge-config` fornece essa configuração apenas sob as mesmas restrições locais das demais rotas. URLs particulares do 2D e seus arquivos não precisam ser publicados neste repositório.

O envio depende de ambas as páginas e do servidor local estarem disponíveis. Se a janela for bloqueada, o servidor estiver desligado ou a configuração de origem não corresponder, o 2D deve explicar a falha e manter a exportação manual de PNG + JSON disponível. A conexão não fornece chave de API e não libera gasto com geração.

## Validação local em 22/09/2026

O teste integrado no navegador usou o gerador em 8766 e o laboratório em 8771. O primeiro clique abriu a janela do laboratório, salvou PNG + ficha e selecionou o registro correto. Reenviar a mesma seleção retornou o mesmo hash e confirmou reaproveitamento. Trocar apenas o traje e reenviar criou outro registro, conservando as demais características.

Os dois PNGs recebidos têm 900 × 1280 pixels, RGBA e transparência real (alpha de 0 a 255). A ficha registra a versão `2dc-r3` em vez de inferi-la; as execuções dos personagens continuam vazias. Não houve chamada de geração. Os dados privados desse ensaio permanecem em `outputs/`, fora do Git.

A suíte do laboratório passou com 88 testes, incluindo 16 testes da ponte para origem/janela, mensagens repetidas, concorrência, expiração, formato e tamanho do payload. As verificações de tipos também passaram. O site 2D publicado não foi atualizado nesta etapa; a conexão foi validada nas prévias locais.
