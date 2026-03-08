# Estrutura Firestore (MVP)

## Coleções principais

- `users/{userId}`: perfil do usuário, role, casaId, tokens push.
- `casas/{casaId}`: cadastro de casa, inquilino, contrato.
- `alugueis/{casaId}/pagamentos/{mes}`: status e histórico mensal de aluguel.
- `chamados/{chamadoId}`: chamados de manutenção.
- `avisos/{avisoId}`: mural de avisos.
- `chat/geral/mensagens/{msgId}`: conversa de grupo.
- `chat/privado/{chatId}/mensagens/{msgId}`: conversa privada.
- `visitantes/{visitanteId}`: visitantes esperados/no portão.
- `documentos/{casaId}/docs/{docId}`: contratos e documentos por casa.
- `contatosEmergencia/{contactId}`: contatos de emergência.
- `acessos/{acessoId}`: histórico de abertura/fechamento do portão.
- `configuracoes/global`: parâmetros configuráveis do app.
- `configuracoes/gateStatus`: estado do portão.

## Futuro (já previsto na arquitetura)

- `reservas/{reservaId}`
- `leituras/{casaId}/energia/{mes}`
- `horta/canteiros/{canteiroId}`
- `ferramentas/{ferramentaId}`
- `entregas/{entregaId}`
