// Lazy factory: no imports, DOM access, RPC call, or secret storage until DSH loads it.
window.__ModuleLoader__.load({ id: '@masspedro/dsh-mcp-console', factory: (require) => {
  const React = require('react');
  const { z } = require('zod');
  const { Button, Modal, Checkbox, Switch } = require('@deepseek-ai/dsh-client-ui-primitives');
  const h = React.createElement;
  /* BUILD_SHARED_CONTRACT */
  const { schemas, result: snapshotSchema } = makeSchemas(z);
  const en = {
    nav: 'MCP', title: 'MCP servers', intro: 'Manage servers saved by this console in the active profile. Activate explicitly to make their tools available.',
    loading: 'Loading servers…', refresh: 'Refresh saved list', refreshNote: 'Reads saved configuration and status only. Does not reconnect or refresh MCP tools.', add: 'Add server', edit: 'Edit configuration', save: 'Save server', cancel: 'Cancel', close: 'Close', remove: 'Delete', start: 'Activate', stop: 'Deactivate', test: 'Test connection', testUnavailable: 'This backend has no reviewed connection-test API. Starting is not a test; no request will be sent.',
    scopeTitle: 'Profile scope & security', scopeNote: 'Save validates and activates; opening or refreshing this screen does not connect. Save or turning the integration on can execute the local command or contact the HTTP server. Connections belong to the active profile; their tools can be shared by sessions in that profile. Deactivation removes the app handle; remote shutdown and credential revocation are not verified.', vaultSecurity: 'Vault security & credential handling', verifiedAt: 'Last verified', verificationTimeUnavailable: 'Verification time unavailable', verificationNote: 'Initial MCP handshake and tool sync were verified then; this is not continuous health monitoring.',
    reconnect: 'Reconnect & refresh tools', reconnectUnavailable: 'Reconnect is unavailable on this backend.', reconnectTitle: 'Reconnect and refresh this server’s tools?', reconnectText: 'This closes the current app child and revalidates the saved configuration, performs a new MCP handshake, and resyncs tools. It may run the local command again or contact the HTTP server. Tools are profile-scoped and may be shared with other sessions. Closing the app child does not verify remote server shutdown or revoke credentials.', acknowledgeReconnect: 'I authorize reconnecting and refreshing this server’s tools now', confirmReconnect: 'Reconnect & refresh tools',
    ownedTitle: 'Console servers', ownedSource: 'Source: this console / active profile', externalSource: 'Source: native MCP / unmanaged', empty: 'No servers have been created by this console in this profile.', label: 'Display name', transport: 'Connection type', http: 'HTTP (Streamable HTTP)', stdio: 'Local process (stdio)', transportNote: 'Only Streamable HTTP and stdio are supported by this backend. Header, Bearer token, and environment references are supported. OAuth login/refresh and legacy SSE are not supported.', command: 'Command or absolute executable path', commandNote: 'Use an executable name such as node, npx or python, or an absolute path. No inline shell, relative paths, shell expansion, or automatic installation by the console.', args: 'Arguments (JSON array)', argsNote: 'Non-secret arguments only, at most 64. Put credentials in vault environment references, never in arguments.', cwd: 'Absolute working directory (optional)', url: 'Server URL', urlNote: 'HTTPS or loopback HTTP only. No credentials, query parameters, or fragments.',
    refsTitle: 'Vault references', refsNote: 'Only reference names are saved here, never secret values. Configure tokens and passwords in the vault below. Removing a mapping does not delete its vault secret.', envName: 'Environment variable', headerName: 'HTTP header', reference: 'Vault reference', mappingAction: 'Reference action', keep: 'Keep', replace: 'Replace', clear: 'Clear', keepRef: 'Keep the saved reference', clearRef: 'Remove this mapping on save', addRef: 'Add reference', addBearer: 'Add Authorization / Bearer reference', bearerNote: 'Use an Authorization header reference whose vault value is the full Bearer header. Select Bearer token when storing the secret to add the prefix safely.', noRefs: 'No environment or header credentials configured.', review: 'Configuration details (no secret values)',
    disabled: 'Disabled', 'activation-verified': 'Active · last verification succeeded', 'mounted-status-unavailable': 'Mounted in the app; connection not verified', 'mount-failed': 'Mount failed', 'stop-failed': 'Stop failed; app handle retained', 'unmounted-shutdown-unverified': 'Disabled in the app; server shutdown not confirmed', statusNote: 'Mounted is not proof of a live connection. Removing an app handle does not verify remote shutdown or credential revocation. The browser never starts or reconnects automatically. Backend startup may restore explicitly saved on preferences.',
    confirmTitle: 'Activate this server?', confirmText: 'Activation can execute this command or contact this URL and attempts an initial MCP handshake and tool sync. Only a verified result is labeled verified; this is not continuous health monitoring. Tools belong to the active profile and may be shared with other sessions. Host execution rules remain unchanged. Deactivation does not verify remote shutdown or revoke credentials.', acknowledge: 'I authorize activating this server now', confirmStart: 'Activate this server', confirmDelete: 'Delete this console configuration?', deleteNote: 'This removes only the console configuration no longer mounted by the app. It does not confirm server shutdown. Native MCP configurations and vault secrets are left unchanged.',
    vaultTitle: 'Credentials vault', vaultNote: 'Plugin-only AES-256-GCM + scrypt vault, not Android Keystore. Restart and timeout lock the vault. There is no passphrase recovery. Locking clears plugin memory and requests owned mounts to stop; it cannot verify remote shutdown or revoke remote credentials.', passphrase: 'Passphrase (12–512 characters)', initialize: 'Create locked vault', unlock: 'Unlock for 5 minutes', lock: 'Lock vault / stop owned mounts', locked: 'Locked', unlocked: 'Unlocked (temporary)', noSecrets: 'No stored references.', secretRef: 'Reference name', secretValue: 'New token or password (write-only)', secretFormat: 'New value format', raw: 'Password / exact value', bearer: 'Bearer token (prefix added)', secretAction: 'Secret action', keepSecret: 'Keep the stored value; no secret is read or sent.', replaceSecret: 'Only the new value is submitted. Saved secrets are never displayed.', clearSecret: 'Delete this unused vault secret; this is not a remote credential revocation.', saveSecret: 'Apply secret change', addSecret: 'Add credential', editSecret: 'Edit credential', deleteSecretTitle: 'Delete this unused secret?', deleteSecretNote: 'Only the plugin vault value is deleted. This does not revoke the credential at its provider.', referencedBy: 'Used by', unused: 'Not referenced by a console server', inUse: 'Remove this reference from all console configurations before deleting its secret.', secretsNote: 'Stop all console servers and unlock the vault before replacing or clearing credentials. Never put secrets in labels, URLs, arguments, paths, or reference names. Inputs are masked and cleared after submission, lock, reconnect, or leaving the page.',
    externalTitle: 'Native MCP servers · unmanaged', externalNote: 'Only currently mounted native namespaces are listed, not all profile entries. Existing native configurations stay unmanaged: no copying, importing, editing, stopping, or deleting them.', unavailable: 'Native inventory unavailable.', externalEmpty: 'No external mounted namespace is visible.', serviceTitle: 'MCP console service unavailable', serviceNote: 'Check that the backend of this plugin is active in the current profile and that the host connection is ready, then refresh. Native MCP configuration is left unchanged.',
    error: 'The operation could not be confirmed. Refresh the state before retrying. Upstream diagnostics are hidden to protect credentials.', conflict: 'Configuration changed. Refresh and review before retrying.', owner: 'Only the authenticated host owner may use this console.', success: 'Done.', kept: 'Stored credential kept; no change was sent.', stoppingNote: 'Stop failed or shutdown is unverified. Check the server itself before restarting or revoking credentials.',
    rpcDiagnostics: {
      'gateway/service-unavailable': 'The console backend service is unavailable.', 'gateway/method-unavailable': 'The requested console method is unavailable.', 'gateway/definition-unavailable': 'The console RPC definition is unavailable.', 'gateway/invocation-unavailable': 'The RPC invocation is unavailable.', 'gateway/ambiguous-endpoint': 'The console RPC endpoint is ambiguous.',
      'gateway/input-invalid': 'The host rejected the console RPC input.', 'gateway/result-invalid': 'The host rejected the console RPC result.', 'gateway/binding-invalid': 'The console RPC binding is incompatible.', 'gateway/signature-invalid': 'The console RPC signature is incompatible.', 'gateway/arguments-invalid': 'The console RPC arguments are incompatible.', 'gateway/internal': 'An internal gateway error prevented this request.', 'remote-access/denied': 'Host-owner authentication is required.',
      'uncategorized-transport': 'The host connection could not complete this request.', 'uncategorized-rpc': 'The RPC request failed without a recognized diagnostic category.', 'snapshot-contract-failed': 'The console response is incompatible with this frontend.'
    },
    errors: { 'credential-argument': 'Credential-shaped arguments are refused. Use a vault environment reference.', 'vault-locked': 'Unlock the vault first.', 'unsafe-url': 'Use HTTPS or loopback HTTP without credentials, query or fragment.', 'invalid-input': 'Check the required fields, reference names, limits, and JSON argument syntax.', 'invalid-url': 'Invalid server URL.', 'invalid-headers': 'Header names must be unique (case-insensitive); hop-by-hop headers are not allowed.', 'vault-unlock-failed': 'Wrong passphrase or invalid/tampered vault.', 'unlock-rate-limited': 'Too many unlock attempts. Wait 30 seconds.', 'stop-before-edit': 'Stop this server before editing.', 'stop-before-delete': 'Stop this server before deleting.', 'stop-before-secret-change': 'Stop all console servers before changing secrets.', 'secret-in-use': 'Remove the reference from all console configurations first.', 'secret-missing': 'A referenced secret is missing. Unlock the vault and create the reference.', 'mount-failed': 'Official MCP child failed to mount; a live connection is not confirmed.', 'stop-failed': 'Owned child cleanup failed. Do not restart blindly; retry stop or unload the plugin.', 'store-busy': 'Another writer holds the plugin store lock.', 'store-write-failed': 'Store publication failed. Refresh to inspect the saved state.', 'store-invalid': 'The plugin store is invalid; operation refused.', 'revision-conflict': 'Configuration changed. Refresh and review.', 'snapshot-contract-failed': 'The backend response is incompatible. Confirm matching plugin versions and refresh.', 'not-owned': 'This server is not owned by the console in the active profile.', 'server-limit': 'At most 32 console servers are allowed.', 'secret-limit': 'At most 128 vault references are allowed.', 'vault-exists': 'A vault already exists. Refresh and unlock it.', 'vault-not-initialized': 'Create the vault first.', 'disposed': 'The backend was unloaded. Check plugin activation and refresh.' }
  };
  const pt = {
    nav: 'MCP', title: 'Servidores MCP', intro: 'Gerencie servidores salvos por este console no perfil ativo. Ative explicitamente para disponibilizar as ferramentas.',
    loading: 'Carregando servidores…', refresh: 'Atualizar lista salva', refreshNote: 'Lê apenas configurações e status salvos. Não reconecta nem atualiza ferramentas MCP.', add: 'Adicionar servidor', edit: 'Editar configuração', save: 'Salvar servidor', cancel: 'Cancelar', close: 'Fechar', remove: 'Excluir', start: 'Ativar', stop: 'Desativar', test: 'Testar conexão', testUnavailable: 'Este backend não oferece uma API revisada para testar conexão. Iniciar não é um teste; nenhuma solicitação será enviada.',
    scopeTitle: 'Escopo do perfil e segurança', scopeNote: 'Salvar valida e ativa; abrir ou atualizar esta tela não conecta. Salvar ou ligar a integração pode executar o comando local ou contatar o servidor HTTP. Conexões pertencem ao perfil ativo; suas ferramentas podem ser compartilhadas por sessões desse perfil. Desativar remove o identificador no app; encerramento remoto e revogação de credenciais não são verificados.', vaultSecurity: 'Segurança do cofre e das credenciais', verifiedAt: 'Última verificação', verificationTimeUnavailable: 'Horário da verificação indisponível', verificationNote: 'O handshake MCP inicial e a sincronização de ferramentas foram verificados naquele momento; não há monitoramento contínuo de saúde.',
    reconnect: 'Reconectar e atualizar ferramentas', reconnectUnavailable: 'A reconexão está indisponível neste backend.', reconnectTitle: 'Reconectar e atualizar as ferramentas deste servidor?', reconnectText: 'Fecha o processo filho atual no app e revalida a configuração salva, realiza um novo handshake MCP e sincroniza as ferramentas. Pode executar novamente o comando local ou contatar o servidor HTTP. Ferramentas pertencem ao perfil e podem ser compartilhadas com outras sessões. Fechar o processo filho no app não confirma encerramento remoto nem revoga credenciais.', acknowledgeReconnect: 'Autorizo reconectar e atualizar as ferramentas deste servidor agora', confirmReconnect: 'Reconectar e atualizar ferramentas',
    ownedTitle: 'Servidores do console', ownedSource: 'Origem: este console / perfil ativo', externalSource: 'Origem: MCP nativo / não gerenciado', empty: 'Nenhum servidor foi criado por este console neste perfil.', label: 'Nome de exibição', transport: 'Tipo de conexão', http: 'HTTP (Streamable HTTP)', stdio: 'Processo local (stdio)', transportNote: 'Este backend suporta apenas Streamable HTTP e stdio. São aceitas referências de cabeçalhos, token Bearer e ambiente. Login/renovação OAuth e SSE legado não são suportados.', command: 'Comando ou caminho absoluto do executável', commandNote: 'Use um nome de executável como node, npx ou python, ou um caminho absoluto. Sem shell inline, caminhos relativos, expansão de shell ou instalação automática pelo console.', args: 'Argumentos (array JSON)', argsNote: 'Somente argumentos sem segredos, no máximo 64. Use referências de ambiente do cofre para credenciais, nunca argumentos.', cwd: 'Diretório de trabalho absoluto (opcional)', url: 'URL do servidor', urlNote: 'Somente HTTPS ou HTTP de loopback. Sem credenciais, parâmetros de consulta ou fragmentos.',
    refsTitle: 'Referências do cofre', refsNote: 'Só nomes de referências são salvos aqui, nunca valores secretos. Configure tokens e senhas no cofre abaixo. Remover um mapeamento não exclui o segredo do cofre.', envName: 'Variável de ambiente', headerName: 'Cabeçalho HTTP', reference: 'Referência do cofre', mappingAction: 'Ação da referência', keep: 'Manter', replace: 'Substituir', clear: 'Limpar', keepRef: 'Manter a referência salva', clearRef: 'Remover este mapeamento ao salvar', addRef: 'Adicionar referência', addBearer: 'Adicionar referência Authorization / Bearer', bearerNote: 'Use uma referência no cabeçalho Authorization cujo valor no cofre seja o cabeçalho Bearer completo. Selecione Token Bearer ao guardar o segredo para adicionar o prefixo com segurança.', noRefs: 'Nenhuma credencial de ambiente ou cabeçalho configurada.', review: 'Detalhes da configuração (sem valores secretos)',
    disabled: 'Desativado', 'activation-verified': 'Ativo · última verificação concluída', 'mounted-status-unavailable': 'Montado no app; conexão não verificada', 'mount-failed': 'Falha na montagem', 'stop-failed': 'Falha ao parar; identificador do app mantido', 'unmounted-shutdown-unverified': 'Desativado no app; encerramento do servidor não confirmado', statusNote: 'Montado não comprova conexão ativa. Remover um identificador do app não confirma encerramento remoto nem revogação de credenciais. O navegador nunca inicia ou reconecta automaticamente. O backend pode restaurar preferências explicitamente salvas como ligadas na inicialização.',
    confirmTitle: 'Ativar este servidor?', confirmText: 'Ativar pode executar este comando ou contatar esta URL e tenta um handshake MCP inicial com sincronização de ferramentas. Apenas um resultado verificado é indicado como verificado; não há monitoramento contínuo de saúde. Ferramentas pertencem ao perfil ativo e podem ser compartilhadas com outras sessões. As regras de execução do app não mudam. Desativar não confirma encerramento remoto nem revoga credenciais.', acknowledge: 'Autorizo ativar este servidor agora', confirmStart: 'Ativar este servidor', confirmDelete: 'Excluir esta configuração do console?', deleteNote: 'Remove apenas a configuração do console não montada pelo app. Não confirma encerramento do servidor. Configurações MCP nativas e segredos do cofre permanecem intactos.',
    vaultTitle: 'Cofre de credenciais', vaultNote: 'Cofre AES-256-GCM + scrypt exclusivo do plugin; não é Android Keystore. Reiniciar e expirar o prazo bloqueiam o cofre. Não há recuperação da frase-senha. Bloquear limpa a memória do plugin e solicita parar montagens próprias; não confirma encerramento remoto nem revoga credenciais remotas.', passphrase: 'Frase-senha (12–512 caracteres)', initialize: 'Criar cofre bloqueado', unlock: 'Desbloquear por 5 minutos', lock: 'Bloquear cofre / parar montagens próprias', locked: 'Bloqueado', unlocked: 'Desbloqueado (temporário)', noSecrets: 'Nenhuma referência armazenada.', secretRef: 'Nome da referência', secretValue: 'Novo token ou senha (somente gravação)', secretFormat: 'Formato do novo valor', raw: 'Senha / valor exato', bearer: 'Token Bearer (prefixo adicionado)', secretAction: 'Ação do segredo', keepSecret: 'Mantém o valor salvo; nenhum segredo é lido ou enviado.', replaceSecret: 'Somente o novo valor é enviado. Segredos salvos nunca são exibidos.', clearSecret: 'Exclui este segredo não utilizado do cofre; não revoga a credencial remota.', saveSecret: 'Aplicar alteração do segredo', addSecret: 'Adicionar credencial', editSecret: 'Editar credencial', deleteSecretTitle: 'Excluir este segredo não utilizado?', deleteSecretNote: 'Só o valor no cofre do plugin é excluído. Isso não revoga a credencial no provedor.', referencedBy: 'Usado por', unused: 'Não referenciado por um servidor do console', inUse: 'Remova esta referência de todas as configurações do console antes de excluir o segredo.', secretsNote: 'Pare todos os servidores do console e desbloqueie o cofre antes de substituir ou limpar credenciais. Nunca coloque segredos em nomes, URLs, argumentos, caminhos ou nomes de referências. Campos são mascarados e limpos após envio, bloqueio, reconexão ou saída da página.',
    externalTitle: 'Servidores MCP nativos · não gerenciados', externalNote: 'A lista mostra apenas namespaces nativos montados, não todas as entradas do perfil. Configurações nativas existentes permanecem não gerenciadas: sem copiar, importar, editar, parar ou excluir.', unavailable: 'Inventário nativo indisponível.', externalEmpty: 'Nenhum namespace externo montado está visível.', serviceTitle: 'Serviço do console MCP indisponível', serviceNote: 'Verifique se o backend deste plugin está ativo no perfil atual e se a conexão com o app está pronta; depois atualize. A configuração MCP nativa permanece intacta.',
    error: 'Não foi possível confirmar a operação. Atualize o estado antes de tentar novamente. Diagnósticos externos são ocultados para proteger credenciais.', conflict: 'A configuração mudou. Atualize e revise antes de tentar novamente.', owner: 'Somente o proprietário autenticado do app pode usar este console.', success: 'Concluído.', kept: 'Credencial salva mantida; nenhuma alteração foi enviada.', stoppingNote: 'Houve falha ao parar ou o encerramento não foi verificado. Confira o próprio servidor antes de reiniciar ou revogar credenciais.',
    rpcDiagnostics: {
      'gateway/service-unavailable': 'O serviço de backend do console está indisponível.', 'gateway/method-unavailable': 'O método solicitado do console está indisponível.', 'gateway/definition-unavailable': 'A definição RPC do console está indisponível.', 'gateway/invocation-unavailable': 'A invocação RPC está indisponível.', 'gateway/ambiguous-endpoint': 'O endpoint RPC do console é ambíguo.',
      'gateway/input-invalid': 'O app rejeitou a entrada RPC do console.', 'gateway/result-invalid': 'O app rejeitou o resultado RPC do console.', 'gateway/binding-invalid': 'O vínculo RPC do console é incompatível.', 'gateway/signature-invalid': 'A assinatura RPC do console é incompatível.', 'gateway/arguments-invalid': 'Os argumentos RPC do console são incompatíveis.', 'gateway/internal': 'Um erro interno do gateway impediu esta solicitação.', 'remote-access/denied': 'É necessária a autenticação do proprietário do app.',
      'uncategorized-transport': 'A conexão com o app não concluiu esta solicitação.', 'uncategorized-rpc': 'A solicitação RPC falhou sem uma categoria de diagnóstico reconhecida.', 'snapshot-contract-failed': 'A resposta do console é incompatível com este frontend.'
    },
    errors: { 'credential-argument': 'Argumentos com aparência de credencial são recusados. Use uma referência de ambiente do cofre.', 'vault-locked': 'Desbloqueie o cofre primeiro.', 'unsafe-url': 'Use HTTPS ou HTTP de loopback sem credenciais, consulta ou fragmento.', 'invalid-input': 'Confira campos obrigatórios, nomes de referências, limites e sintaxe JSON dos argumentos.', 'invalid-url': 'URL do servidor inválida.', 'invalid-headers': 'Cabeçalhos devem ter nomes únicos (sem diferenciar maiúsculas); cabeçalhos de transporte não são permitidos.', 'vault-unlock-failed': 'Frase-senha incorreta ou cofre inválido/adulterado.', 'unlock-rate-limited': 'Muitas tentativas. Aguarde 30 segundos.', 'stop-before-edit': 'Pare este servidor antes de editar.', 'stop-before-delete': 'Pare este servidor antes de excluir.', 'stop-before-secret-change': 'Pare todos os servidores do console antes de alterar segredos.', 'secret-in-use': 'Remova a referência de todas as configurações do console primeiro.', 'secret-missing': 'Falta um segredo referenciado. Desbloqueie o cofre e crie a referência.', 'mount-failed': 'A montagem MCP oficial falhou; conexão ativa não confirmada.', 'stop-failed': 'A limpeza do servidor próprio falhou. Não reinicie às cegas; tente parar ou descarregue o plugin.', 'store-busy': 'Outro escritor bloqueia o armazenamento do plugin.', 'store-write-failed': 'Falha ao publicar o armazenamento. Atualize para conferir o estado salvo.', 'store-invalid': 'Armazenamento do plugin inválido; operação recusada.', 'revision-conflict': 'A configuração mudou. Atualize e revise.', 'snapshot-contract-failed': 'Resposta do backend incompatível. Confira as versões do plugin e atualize.', 'not-owned': 'Este servidor não pertence ao console no perfil ativo.', 'server-limit': 'São permitidos no máximo 32 servidores do console.', 'secret-limit': 'São permitidas no máximo 128 referências no cofre.', 'vault-exists': 'O cofre já existe. Atualize e desbloqueie.', 'vault-not-initialized': 'Crie o cofre primeiro.', 'disposed': 'O backend foi descarregado. Confira a ativação do plugin e atualize.' }
  };
  Object.assign(en, { token: 'HTTP TOKEN (optional)', tokenNote: 'Leave blank to preserve saved credentials. For Bearer, paste only the token: Authorization: Bearer is added automatically. No token is displayed again.', tokenLocked: 'Initialize and unlock the vault explicitly before entering a token. This console will not unlock it for you.', tokenMounted: 'Deactivate every console server before entering a token. No server is stopped automatically.', tokenAuth: 'Advanced authentication', tokenAuthNote: 'Choose the format required by this specific server. MCP does not have one universal authentication scheme.', tokenMode: 'Token header', tokenBearer: 'Authorization: Bearer (default)', tokenApiKey: 'X-API-Key (raw)', tokenAuthToken: 'X-Auth-Token (raw)', tokenCustom: 'Custom header', tokenCustomFormat: 'Custom token format', advancedHeaders: 'Advanced HTTP header bindings', advancedVault: 'Advanced vault credentials', addHeader: 'Add header', removeHeader: 'Delete header binding', customHeader: 'Custom…', selectHeader: 'Choose a header', tokenPending: 'Encrypted credential saved separately; server save is not confirmed. Retry will first reconcile the saved list. The old shared credential was not overwritten. The generated reference is retained; no vault secret is deleted.', tokenUncertain: 'Credential write could not be confirmed. The generated reference is retained for reconciliation. Retry first checks the vault and server list; no vault secret is deleted.', tokenMissing: 'The retained reference is not in the refreshed vault. Reenter the token to create a different fresh reference, or cancel. The earlier reference will not be deleted.', retryTokenSave: 'Reconcile and retry server save' });
  Object.assign(pt, { token: 'TOKEN HTTP (opcional)', tokenNote: 'Deixe vazio para manter as credenciais salvas. Para Bearer, cole só o token: Authorization: Bearer é adicionado automaticamente. O token não será exibido novamente.', tokenLocked: 'Inicialize e desbloqueie o cofre explicitamente antes de inserir um token. O console não desbloqueia por você.', tokenMounted: 'Desative todos os servidores do console antes de inserir um token. Nenhum servidor é parado automaticamente.', tokenAuth: 'Autenticação avançada', tokenAuthNote: 'Escolha o formato exigido por este servidor específico. MCP não tem um único esquema universal de autenticação.', tokenMode: 'Cabeçalho do token', tokenBearer: 'Authorization: Bearer (padrão)', tokenApiKey: 'X-API-Key (valor puro)', tokenAuthToken: 'X-Auth-Token (valor puro)', tokenCustom: 'Cabeçalho personalizado', tokenCustomFormat: 'Formato do token personalizado', advancedHeaders: 'Mapeamentos avançados de cabeçalhos HTTP', advancedVault: 'Credenciais avançadas do cofre', addHeader: 'Adicionar cabeçalho', removeHeader: 'Excluir mapeamento do cabeçalho', customHeader: 'Personalizado…', selectHeader: 'Escolha um cabeçalho', tokenPending: 'Credencial criptografada salva separadamente; o salvamento do servidor não foi confirmado. Tentar novamente primeiro concilia a lista salva. A credencial antiga compartilhada não foi sobrescrita. A referência gerada é mantida; nenhum segredo do cofre é excluído.', tokenUncertain: 'Não foi possível confirmar a gravação da credencial. A referência gerada é mantida para conciliação. Tentar novamente primeiro confere o cofre e a lista de servidores; nenhum segredo do cofre é excluído.', tokenMissing: 'A referência mantida não está no cofre atualizado. Insira o token novamente para criar outra referência nova ou cancele. A referência anterior não será excluída.', retryTokenSave: 'Conciliar e tentar salvar o servidor' });
  Object.assign(en, { token: 'Token (optional)', tokenNote: 'Paste only the token; Authorization: Bearer is added automatically. Or leave Token empty and enter the complete Authorization value in Headers below. Blank saved values are preserved.', headers: 'Headers (optional)', headerValue: 'Header value', headerValueNote: 'Enter the exact value, including Bearer if required. Leave blank to preserve an existing saved value. Values are encrypted and never displayed again.', headerRenameNote: 'Changing a saved header name requires reentering its value; an opaque saved credential is never moved automatically.', tokenPending: 'Some encrypted credentials were saved separately; server save is not confirmed. Retry first checks saved state. No old credential was overwritten and no vault secret is deleted.', tokenUncertain: 'Credential writes could not all be confirmed. Remaining values were cleared. Retry first checks the vault and saved server; only references and status are retained.', tokenMissing: 'Reenter values for the missing credentials, then Save. Existing encrypted credentials are kept; new values get different fresh references.' });
  Object.assign(pt, { token: 'Token (opcional)', tokenNote: 'Cole só o token; Authorization: Bearer é adicionado automaticamente. Ou deixe Token vazio e insira o valor completo de Authorization em Cabeçalhos abaixo. Valores salvos vazios são mantidos.', headers: 'Cabeçalhos (opcionais)', headerValue: 'Valor do cabeçalho', headerValueNote: 'Insira o valor exato, incluindo Bearer quando necessário. Deixe vazio para manter um valor já salvo. Os valores são criptografados e nunca exibidos novamente.', headerRenameNote: 'Ao mudar o nome de um cabeçalho salvo, insira seu valor novamente; uma credencial salva opaca nunca é movida automaticamente.', tokenPending: 'Algumas credenciais criptografadas foram salvas separadamente; o salvamento do servidor não foi confirmado. Tentar novamente primeiro confere o estado salvo. Nenhuma credencial antiga foi sobrescrita e nenhum segredo do cofre é excluído.', tokenUncertain: 'Não foi possível confirmar todas as gravações de credenciais. Os valores restantes foram limpos. Tentar novamente primeiro confere o cofre e o servidor salvo; só referências e estado são mantidos.', tokenMissing: 'Insira novamente os valores das credenciais ausentes e salve. Credenciais já criptografadas são mantidas; os novos valores recebem outras referências novas.' });
  Object.assign(en, { tokenLocked: 'You may type now. Saving new values requires explicitly creating or unlocking the encrypted vault.', editorVaultTitle: 'Encrypt these credentials before saving', editorVaultNote: 'Enter your own passphrase (12–512 characters). This only creates/unlocks the vault; your Token and header values stay in these fields. Then click Save. No server is activated.', createAndUnlock: 'Create and unlock vault', editorUnlock: 'Unlock vault', editorVaultReady: 'Vault ready. Click Save to encrypt the values and save this server.' });
  Object.assign(pt, { tokenLocked: 'Você já pode digitar. Para salvar novos valores, crie ou desbloqueie explicitamente o cofre criptografado.', editorVaultTitle: 'Criptografe estas credenciais antes de salvar', editorVaultNote: 'Informe sua própria frase-senha (12–512 caracteres). Esta ação só cria/desbloqueia o cofre; Token e valores dos cabeçalhos permanecem nos campos. Depois clique em Salvar. Nenhum servidor é ativado.', createAndUnlock: 'Criar e desbloquear cofre', editorUnlock: 'Desbloquear cofre', editorVaultReady: 'Cofre pronto. Clique em Salvar para criptografar os valores e salvar este servidor.' });
  en.tokenAndHeaders = 'Token and headers'; pt.tokenAndHeaders = 'Token e headers';
  en.errors['authorization-ambiguous'] = 'Use either Token or an entered Authorization header value, not both.';
  pt.errors['authorization-ambiguous'] = 'Use Token ou um valor preenchido no cabeçalho Authorization, não os dois.';
  en.errors['header-reentry-required'] = 'Reenter the value when renaming a saved header, or keep its original name.';
  pt.errors['header-reentry-required'] = 'Insira o valor novamente ao renomear um cabeçalho salvo ou mantenha o nome original.';
  Object.assign(en, { automaticSecurity: 'Saved credential security', automaticSecurityNote: 'New values are encrypted automatically with a key in private app files, not Android Keystore. Root or code in the same app process can access that key. Saved values are never displayed or returned by this console. Empty fields preserve existing credentials. Save validates and activates the server; credential storage and connection verification are separate steps.', legacyVault: 'Legacy password vault (advanced)', savedAuthentication: 'Authentication saved; leave Token blank to preserve it.', savedHeaderValue: 'Value saved; leave blank to preserve it.' });
  Object.assign(pt, { automaticSecurity: 'Segurança das credenciais salvas', automaticSecurityNote: 'Novos valores são criptografados automaticamente com uma chave nos arquivos privados do app, não no Android Keystore. Root ou código no mesmo processo do app podem acessar essa chave. Valores salvos nunca são exibidos nem devolvidos pelo console. Campos vazios mantêm as credenciais existentes. Salvar valida e ativa o servidor; armazenamento de credenciais e verificação da conexão são etapas separadas.', legacyVault: 'Cofre antigo com frase-senha (avançado)', savedAuthentication: 'Autenticação salva; deixe Token vazio para manter.', savedHeaderValue: 'Valor salvo; deixe vazio para manter.' });
  en.reloadAutomaticHost = 'Reload the updated MCP console plugin to use automatic credential saving. Typed values remain here; no password vault or credential is created.'; pt.reloadAutomaticHost = 'Recarregue o plugin Console MCP atualizado para salvar credenciais automaticamente. Os valores digitados permanecem aqui; não é criado cofre com frase-senha nem credencial.';
  en.errors['vault-key-unavailable'] = 'The private app credential key is unavailable. No replacement key or plaintext fallback is used.'; pt.errors['vault-key-unavailable'] = 'A chave privada de credenciais do app está indisponível. Não é criada outra chave nem usado armazenamento sem criptografia.';
  en.errors['automatic-mode'] = 'Credentials are handled automatically; no manual vault operation is required.'; pt.errors['automatic-mode'] = 'As credenciais são gerenciadas automaticamente; nenhuma operação manual do cofre é necessária.';
  en.errors['secure-random-unavailable'] = 'Secure 128-bit randomness is unavailable. No credential was written.';
  pt.errors['secure-random-unavailable'] = 'Aleatoriedade segura de 128 bits indisponível. Nenhuma credencial foi gravada.';
  Object.assign(en, { intro: 'Save validates the connection and tool sync, then adds the server already active in this profile. Use the switch to turn its integration and tools on or off.', save: 'Save & activate', saveActivationNote: 'Save validates and activates this server. It can run the stdio command or contact the URL, perform an MCP handshake, and sync tools. Only verified activation is saved as success. Tools belong to the active profile and may be shared with its sessions.', scopeNote: 'Save validates and activates; opening or refreshing this screen does not connect. Save and turning the integration on can run the local command or contact the HTTP URL. Save validates the initial connection and tool sync before adding the server already active. Tools belong to the active profile and may be shared with its sessions. Turning off removes the app handle; remote shutdown and credential revocation are not verified.', integration: 'Integration & tools', integrationNote: 'Turning on authorizes starting the saved command or contacting its URL and syncing tools. The switch reflects the app handle in the latest snapshot, not continuous connection health. Turning off does not verify remote shutdown or revoke credentials.', reloadSaveHost: 'Reload the updated MCP console plugin to save, validate and activate servers. Typed values remain here; no credentials are written and no server is contacted.', activationUnconfirmed: 'The matching configuration is not confirmed active with verified tool sync. No activation was replayed. Review the saved state, then explicitly click Save & activate to try again.', savePending: 'Save and activation are not confirmed. Save first reconciles the matching configuration and verified active state; it does not blindly replay activation.', retryTokenSave: 'Reconcile / Save & activate', editorVaultReady: 'Vault ready. Click Save & activate to encrypt credentials, validate the connection and sync tools.', automaticSecurityNote: 'New values are encrypted automatically with a key in private app files, not Android Keystore. Root or code in the same app process can access that key. Saved values are never displayed or returned. Empty fields preserve existing credentials. Save validates the connection and tool sync, then activates the server.', tokenPending: 'Encrypted credentials were saved separately; validated activation is not confirmed. Save first checks the matching configuration and verified active state. No old credential was overwritten and no vault secret is deleted.' });
  Object.assign(pt, { intro: 'Salvar valida a conexão e sincroniza as ferramentas antes de adicionar o servidor já ativo neste perfil. Use o interruptor para ativar ou desativar a integração e suas ferramentas.', save: 'Salvar e ativar', saveActivationNote: 'Salvar valida e ativa este servidor. Pode executar o comando stdio ou contatar a URL, realizar um handshake MCP e sincronizar as ferramentas. Só a ativação verificada é considerada sucesso. As ferramentas pertencem ao perfil ativo e podem ser compartilhadas por suas sessões.', scopeNote: 'Salvar valida e ativa; abrir ou atualizar esta tela não conecta. Salvar e ligar a integração podem executar o comando local ou contatar a URL HTTP. Salvar valida a conexão inicial e a sincronização de ferramentas antes de adicionar o servidor já ativo. As ferramentas pertencem ao perfil ativo e podem ser compartilhadas por suas sessões. Desativar remove o identificador no app; encerramento remoto e revogação de credenciais não são verificados.', integration: 'Integração e ferramentas', integrationNote: 'Ligar autoriza executar o comando salvo ou contatar sua URL e sincronizar ferramentas. O interruptor reflete o identificador no app no último estado consultado, não monitoramento contínuo da conexão. Desligar não confirma encerramento remoto nem revoga credenciais.', reloadSaveHost: 'Recarregue o plugin Console MCP atualizado para salvar, validar e ativar servidores. Os valores digitados permanecem aqui; nenhuma credencial é gravada e nenhum servidor é contatado.', activationUnconfirmed: 'A configuração correspondente não está confirmada ativa com sincronização verificada. Nenhuma ativação foi repetida. Revise o estado salvo e clique explicitamente em Salvar e ativar para tentar novamente.', savePending: 'Salvamento e ativação não confirmados. Salvar primeiro concilia a configuração correspondente e o estado ativo verificado; não repete a ativação às cegas.', retryTokenSave: 'Conciliar / Salvar e ativar', editorVaultReady: 'Cofre pronto. Clique em Salvar e ativar para criptografar as credenciais, validar a conexão e sincronizar ferramentas.', automaticSecurityNote: 'Novos valores são criptografados automaticamente com uma chave nos arquivos privados do app, não no Android Keystore. Root ou código no mesmo processo do app podem acessar essa chave. Valores salvos nunca são exibidos nem devolvidos. Campos vazios mantêm as credenciais existentes. Salvar valida a conexão e sincroniza as ferramentas, depois ativa o servidor.', tokenPending: 'Credenciais criptografadas foram salvas separadamente; a ativação validada não está confirmada. Salvar primeiro confere a configuração correspondente e o estado ativo verificado. Nenhuma credencial antiga foi sobrescrita e nenhum segredo do cofre é excluído.' });
  en.errors['save-cleanup-required'] = 'Validation did not succeed and cleanup could not be confirmed. No server configuration was added. Do not retry activation blindly; unload the console plugin to clean up its retained handle first.';
  pt.errors['save-cleanup-required'] = 'A validação não teve sucesso e a limpeza não foi confirmada. Nenhuma configuração de servidor foi adicionada. Não repita a ativação às cegas; descarregue o plugin para limpar primeiro o identificador retido.';
  en.errors['save-state-ambiguous'] = 'The saved state could not be proved or restored. Refresh and reconcile before explicitly authorizing another Save & activate; no activation is retried automatically.';
  pt.errors['save-state-ambiguous'] = 'Não foi possível comprovar ou restaurar o estado salvo. Atualize e concilie antes de autorizar explicitamente outra ação Salvar e ativar; nenhuma ativação é repetida automaticamente.';
  Object.assign(en, { serverInfo: 'Integration, status and verification information', verifying: 'Verifying connection and tool sync', compactVerified: 'Verified', compactUnknown: 'Unverified', compactDisabled: 'Disabled', compactMountFailed: 'Failed', compactStopFailed: 'Stop failed', compactShutdown: 'Off · unconfirmed', statusUnconfirmed: 'Latest connection operation is unconfirmed; an older verification is not proof of its outcome.', reconnectAction: 'Reconnect and refresh MCP tools; may run the saved command again or contact the HTTP server', dateLocale: 'en' });
  Object.assign(pt, { serverInfo: 'Informações sobre integração, status e verificação', verifying: 'Verificando conexão e sincronização de ferramentas', compactVerified: 'Verificado', compactUnknown: 'Não verificado', compactDisabled: 'Desativado', compactMountFailed: 'Falhou', compactStopFailed: 'Falha ao parar', compactShutdown: 'Desligado · incerto', statusUnconfirmed: 'A última operação de conexão não foi confirmada; uma verificação anterior não comprova seu resultado.', reconnectAction: 'Reconectar e atualizar ferramentas MCP; pode executar novamente o comando salvo ou contatar o servidor HTTP', dateLocale: 'pt-BR' });
  Object.assign(en, { targetEditBlocked: 'Disable this MCP to edit.', tokenMounted: 'Deactivate all console servers before saving new Token or header values on this backend. No server is stopped automatically.', appendSecretsNote: 'New Token and header values use fresh encrypted references for new or inactive servers, so other console servers may stay mounted. Existing vault values cannot be replaced or deleted while any console server is mounted.', reloadMountedSecretsHost: 'Reload the updated MCP console plugin to support fresh automatic credentials while other console servers stay mounted. This Save is blocked while that capability is missing; no credentials are written or server contacted. Existing vault values stay protected.' });
  Object.assign(pt, { targetEditBlocked: 'Para editar, desative este MCP.', tokenMounted: 'Desative todos os servidores do console antes de salvar novos valores de Token ou cabeçalhos neste backend. Nenhum servidor é parado automaticamente.', appendSecretsNote: 'Novos valores de Token e cabeçalhos usam referências criptografadas novas em servidores novos ou inativos, então outros servidores do console podem continuar montados. Valores existentes do cofre não podem ser substituídos nem excluídos enquanto algum servidor do console estiver montado.', reloadMountedSecretsHost: 'Recarregue o plugin Console MCP atualizado para oferecer suporte a credenciais automáticas novas enquanto outros servidores do console continuam montados. Este salvamento fica bloqueado enquanto esse recurso estiver ausente; nenhuma credencial é gravada nem servidor contatado. Valores existentes do cofre continuam protegidos.' });
  en.errors['append-secrets-upgrade-required'] = en.reloadMountedSecretsHost;
  pt.errors['append-secrets-upgrade-required'] = pt.reloadMountedSecretsHost;
  en.errors['secret-state-ambiguous'] = 'A previous credential write is uncertain. Further credential changes and credentialed activation are blocked. Resolve the plugin store writer lock, then reload only this MCP console plugin. Reload may clean up or restore explicitly enabled console servers; credential writes are not replayed automatically.';
  pt.errors['secret-state-ambiguous'] = 'Uma gravação anterior de credencial é incerta. Novas alterações de credenciais e ativação com credenciais estão bloqueadas. Resolva o bloqueio de escrita do armazenamento do plugin e recarregue somente este plugin Console MCP. Recarregar pode limpar ou restaurar servidores do console explicitamente habilitados; gravações de credenciais não são repetidas automaticamente.';
  en.errors['preference-state-ambiguous'] = 'The saved on/off preference could not be confirmed. Use explicit OFF or retry-stop if available. Otherwise resolve any store writer-lock condition, then reload only the backend MCP console plugin; refreshing this page does not clear its quarantine.';
  pt.errors['preference-state-ambiguous'] = 'A preferência salva de ligar/desligar não foi confirmada. Use Desligar ou tentar parar novamente, se disponível. Caso contrário, resolva qualquer bloqueio de escrita do armazenamento e recarregue somente o plugin Console MCP no backend; atualizar esta página não limpa a quarentena.';
  Object.assign(en, { persistentIntegrationNote: 'The switch shows the saved on/off preference across DSH and plugin restarts. Turning on authorizes backend startup restoration; the connection status is separate. Failed connections keep the preference on: explicitly retry using the reconnect icon. Turning off saves off even if cleanup fails; use the same icon to retry stopping a retained app handle.', persistentStatusNote: 'The browser never starts or reconnects automatically. Backend startup restores the saved on preference; connection status and verification remain independent.', notConnected: 'Not connected', compactNotConnected: 'Not connected', retryStopAction: 'Retry stopping the retained app handle; integration stays off and no connection is started' });
  Object.assign(pt, { persistentIntegrationNote: 'O interruptor mostra a preferência salva entre reinicializações do DSH e do plugin. Ligar autoriza a restauração pelo backend na inicialização; o status da conexão é separado. Falhas mantêm a preferência ligada: tente novamente pelo ícone de reconexão. Desligar salva a preferência mesmo se a limpeza falhar; use o mesmo ícone para tentar parar o identificador retido no app.', persistentStatusNote: 'O navegador nunca inicia ou reconecta automaticamente. O backend restaura a preferência ligada na inicialização; status e verificação da conexão permanecem independentes.', notConnected: 'Não conectado', compactNotConnected: 'Não conectado', retryStopAction: 'Tentar parar novamente o identificador retido no app; a integração permanece desligada e nenhuma conexão é iniciada' });
  Object.assign(en, { advancedServer: 'Advanced server settings', toolPolicy: 'Tool access policy', policyManage: 'Manage tool access', policyApply: 'Apply policy', policyMode: 'Access mode', policyAll: 'All tools', policyInclude: 'Only selected tools', policyExclude: 'All except selected tools', policyAllNote: 'All current and newly discovered tools are allowed.', policyIncludeNote: 'Only selected exact names are allowed. An empty selection exposes no tools. Newly discovered tools are NOT added automatically.', policyExcludeNote: 'Selected exact names are blocked. New tools not in this list are allowed. An empty list blocks no tools.', policyNamesNote: 'Selections use exact full public names, not server labels or raw remote names. Missing names are retained until you explicitly deselect them.', policyLocalNote: 'Apply changes local tool exposure only. It does not stop/restart the server, change credentials, reconnect, or make an MCP/network/tool call.', policyUnavailable: 'Tool policy is unavailable on this backend. No policy change will be sent.', policyNames: 'Public tool names', policySearch: 'Search public names', policyInventoryMounted: 'Names from the currently mounted inventory.', policyInventoryKnown: 'Last-known names; this is not a live tool refresh.', policyInventoryUnavailable: 'Tool inventory unavailable. Only retained selections can be shown; no remote tool list is requested.', policyNewServer: 'Before the first verified Save, choose Only selected tools with no selection to expose no tools. Save still validates the connection; select verified public names afterward.', policyMissingName: 'Not in the current inventory · selection retained', policySelectionLimit: 'Selected names · maximum 512 unique names', policyRefreshRequired: 'Refresh and review the current server state before retrying Apply. No policy update is replayed automatically.', policyReview: 'Current state refreshed. Review the retained selection, then explicitly Apply if still wanted.', toolTimeout: 'Tool call timeout (seconds)', toolTimeoutNote: 'Integer from 1 to 3600; default 60. Applies to tool calls, not startup/handshake. Deactivate this server before editing its configuration.', timeoutUnavailable: 'Configurable tool timeout is unavailable on this backend.' });
  Object.assign(pt, { advancedServer: 'Configurações avançadas do servidor', toolPolicy: 'Política de acesso às ferramentas', policyManage: 'Gerenciar acesso às ferramentas', policyApply: 'Aplicar política', policyMode: 'Modo de acesso', policyAll: 'Todas as ferramentas', policyInclude: 'Somente ferramentas selecionadas', policyExclude: 'Todas exceto as selecionadas', policyAllNote: 'Todas as ferramentas atuais e recém-descobertas são permitidas.', policyIncludeNote: 'Só os nomes exatos selecionados são permitidos. Uma seleção vazia não expõe ferramentas. Ferramentas novas NÃO são adicionadas automaticamente.', policyExcludeNote: 'Os nomes exatos selecionados são bloqueados. Ferramentas novas fora desta lista são permitidas. Uma lista vazia não bloqueia ferramentas.', policyNamesNote: 'As seleções usam nomes públicos completos e exatos, não rótulos de servidores nem nomes remotos brutos. Nomes ausentes são mantidos até você desmarcá-los explicitamente.', policyLocalNote: 'Aplicar altera apenas a exposição local das ferramentas. Não para/reinicia o servidor, altera credenciais, reconecta nem faz chamadas MCP/de rede/de ferramentas.', policyUnavailable: 'A política de ferramentas está indisponível neste backend. Nenhuma alteração de política será enviada.', policyNames: 'Nomes públicos das ferramentas', policySearch: 'Buscar nomes públicos', policyInventoryMounted: 'Nomes do inventário atualmente montado.', policyInventoryKnown: 'Últimos nomes conhecidos; não é uma atualização ao vivo das ferramentas.', policyInventoryUnavailable: 'Inventário de ferramentas indisponível. Só seleções mantidas podem ser mostradas; nenhuma lista remota é solicitada.', policyNewServer: 'Antes do primeiro salvamento verificado, escolha Somente ferramentas selecionadas sem selecionar nomes para não expor ferramentas. Salvar ainda valida a conexão; selecione nomes públicos verificados depois.', policyMissingName: 'Ausente do inventário atual · seleção mantida', policySelectionLimit: 'Nomes selecionados · máximo de 512 nomes únicos', policyRefreshRequired: 'Atualize e revise o estado atual do servidor antes de tentar Aplicar novamente. Nenhuma atualização de política é repetida automaticamente.', policyReview: 'Estado atual atualizado. Revise a seleção mantida e aplique explicitamente se ainda desejar.', toolTimeout: 'Tempo limite das chamadas de ferramentas (segundos)', toolTimeoutNote: 'Inteiro de 1 a 3600; padrão 60. Vale para chamadas de ferramentas, não inicialização/handshake. Desative este servidor antes de editar a configuração.', timeoutUnavailable: 'Tempo limite configurável de ferramentas indisponível neste backend.' });
  Object.assign(en, { policyRecoverOff: 'Confirm OFF for recovery', policyRecoverOffNote: 'The tool policy needs recovery. Explicitly confirm OFF to save the disabled preference and stop any retained app handle, even if already OFF. This does not revoke credentials or verify remote shutdown. Then Refresh and review before explicitly retrying the policy.' });
  Object.assign(pt, { policyRecoverOff: 'Confirmar OFF para recuperar', policyRecoverOffNote: 'A política precisa de recuperação. Confirme OFF explicitamente para salvar a preferência desligada e parar qualquer handle retido, mesmo se já estiver OFF. Não revoga credenciais nem confirma encerramento remoto. Depois atualize e revise antes de tentar aplicar a política explicitamente.' });
  Object.assign(en.errors, { 'connection-auth-denied': 'Server authentication or authorization was denied. Review the saved credential references.', 'connection-endpoint-unavailable': 'The MCP endpoint is unavailable or was not found.', 'connection-rate-limited': 'The server rate-limited the connection. Wait before an explicit retry.', 'connection-service-unavailable': 'The remote service is temporarily unavailable.', 'connection-timeout': 'The MCP connection timed out.', 'connection-refused': 'The endpoint refused the connection.', 'connection-unreachable': 'The server could not be reached.', 'connection-tls-failed': 'The secure TLS connection failed.', 'connection-invalid-response': 'The server returned an invalid MCP response.', 'tool-policy-unavailable': en.policyUnavailable, 'tool-policy-apply-failed': 'Tool policy could not be applied. Refresh and review before retrying.', 'tool-policy-state-ambiguous': 'Tool policy state is uncertain. Refresh and review before explicitly retrying; no update is replayed automatically.', 'invalid-tool-policy': 'Use all/include/exclude with at most 512 unique exact public names from this server namespace (ASCII, maximum 64 characters). All mode must have an empty list.', 'tool-inventory-limit': 'Tool inventory exceeded the safe limit. No excess names are displayed.', 'invalid-tool-timeout': 'Tool timeout must be an integer from 1 to 3600 seconds.', 'timeout-unavailable': en.timeoutUnavailable });
  Object.assign(pt.errors, { 'connection-auth-denied': 'Autenticação ou autorização recusada pelo servidor. Revise as referências de credenciais salvas.', 'connection-endpoint-unavailable': 'O endpoint MCP está indisponível ou não foi encontrado.', 'connection-rate-limited': 'O servidor limitou a frequência da conexão. Aguarde antes de tentar explicitamente.', 'connection-service-unavailable': 'O serviço remoto está temporariamente indisponível.', 'connection-timeout': 'A conexão MCP excedeu o tempo limite.', 'connection-refused': 'O endpoint recusou a conexão.', 'connection-unreachable': 'Não foi possível alcançar o servidor.', 'connection-tls-failed': 'A conexão segura TLS falhou.', 'connection-invalid-response': 'O servidor retornou uma resposta MCP inválida.', 'tool-policy-unavailable': pt.policyUnavailable, 'tool-policy-apply-failed': 'Não foi possível aplicar a política. Atualize e revise antes de tentar novamente.', 'tool-policy-state-ambiguous': 'O estado da política é incerto. Atualize e revise antes de tentar explicitamente; nenhuma alteração é repetida automaticamente.', 'invalid-tool-policy': 'Use all/include/exclude com até 512 nomes públicos exatos e únicos do namespace deste servidor (ASCII, máximo 64 caracteres). O modo all exige lista vazia.', 'tool-inventory-limit': 'O inventário excedeu o limite seguro. Nomes excedentes não são exibidos.', 'invalid-tool-timeout': 'O tempo limite deve ser um inteiro de 1 a 3600 segundos.', 'timeout-unavailable': pt.timeoutUnavailable });
  // Literal Simplified Chinese catalog: no English fallback and no remote text.
  const zh = {
    nav: 'MCP', title: 'MCP 服务器', intro: '保存会验证连接并同步工具，然后将已启用的服务器添加到当前配置中。使用开关启用或停用集成及工具。',
    loading: '正在加载服务器…', refresh: '刷新已保存列表', refreshNote: '仅读取已保存配置与状态，不会重新连接或刷新 MCP 工具。', add: '添加服务器', edit: '编辑配置', save: '保存并启用', cancel: '取消', close: '关闭', remove: '删除', start: '启用', stop: '停用', test: '测试连接', testUnavailable: '此后端没有经过审核的连接测试接口。启动不等于测试，不会发送请求。',
    scopeTitle: '配置范围与安全', scopeNote: '保存会验证并启用；打开或刷新此页面不会连接。保存或打开集成开关可能运行本地命令或连接 HTTP 地址。保存验证初始连接与工具同步后，会添加已启用的服务器。工具属于当前配置，可能被其中的会话共享。关闭开关会移除应用内句柄，但无法确认远程关闭或凭据撤销。', vaultSecurity: '保险库与凭据安全', verifiedAt: '上次验证', verificationTimeUnavailable: '验证时间不可用', verificationNote: '该时间仅表示初始 MCP 握手与工具同步已验证，不代表持续健康监测。',
    reconnect: '重新连接并刷新工具', reconnectUnavailable: '此后端不支持重新连接。', reconnectTitle: '重新连接并刷新此服务器的工具？', reconnectText: '此操作会关闭当前应用内子进程，重新验证已保存配置，执行新的 MCP 握手并同步工具。可能再次运行本地命令或连接 HTTP 服务器。工具属于当前配置，可能被其他会话共享。关闭应用内子进程不代表远程服务器已关闭，也不会撤销凭据。', acknowledgeReconnect: '我授权立即重新连接并刷新此服务器的工具', confirmReconnect: '重新连接并刷新工具',
    ownedTitle: '控制台服务器', ownedSource: '来源：此控制台／当前配置', externalSource: '来源：原生 MCP／未管理', empty: '此控制台尚未在当前配置中创建服务器。', label: '显示名称', transport: '连接类型', http: 'HTTP（流式 HTTP）', stdio: '本地进程（stdio）', transportNote: '此后端仅支持 Streamable HTTP 和 stdio。支持请求头、Bearer 令牌及环境变量引用，不支持 OAuth 登录／刷新或旧式 SSE。', command: '命令或可执行文件的绝对路径', commandNote: '使用 node、npx、python 等命令名或绝对路径。不支持内联 shell、相对路径、shell 展开或自动安装。', args: '参数（JSON 数组）', argsNote: '最多 64 个非敏感参数。凭据应使用保险库环境变量引用，切勿放入参数。', cwd: '绝对工作目录（可选）', url: '服务器地址', urlNote: '仅支持 HTTPS 或本机回环 HTTP。不允许凭据、查询参数或片段。',
    refsTitle: '保险库引用', refsNote: '这里只保存引用名称，不保存秘密值。请在下方保险库中配置令牌和密码。删除映射不会删除保险库秘密。', envName: '环境变量', headerName: 'HTTP 请求头', reference: '保险库引用', mappingAction: '引用操作', keep: '保留', replace: '替换', clear: '清除', keepRef: '保留已保存引用', clearRef: '保存时删除此映射', addRef: '添加引用', addBearer: '添加 Authorization／Bearer 引用', bearerNote: 'Authorization 请求头应引用完整 Bearer 请求头值。存储秘密时选择 Bearer 令牌可安全添加前缀。', noRefs: '尚未配置环境变量或请求头凭据。', review: '配置详情（不含秘密值）',
    disabled: '已停用', 'activation-verified': '已启用 · 上次验证成功', 'mounted-status-unavailable': '已挂载到应用；连接未验证', 'mount-failed': '挂载失败', 'stop-failed': '停止失败；保留应用内句柄', 'unmounted-shutdown-unverified': '已在应用中停用；服务器关闭未确认', statusNote: '挂载不代表连接有效。移除应用内句柄不代表远程关闭或凭据撤销。浏览器不会自动启动或重新连接；后端启动时可能恢复明确保存的启用状态。',
    confirmTitle: '启用此服务器？', confirmText: '启用可能运行此命令或连接此地址，并尝试初始 MCP 握手及工具同步。仅经过验证的结果会标记为已验证，不代表持续健康监测。工具属于当前配置，可能被其他会话共享。主机执行规则不变。停用不代表远程关闭，也不会撤销凭据。', acknowledge: '我授权立即启用此服务器', confirmStart: '启用此服务器', confirmDelete: '删除此控制台配置？', deleteNote: '仅删除应用中已不再挂载的控制台配置，无法确认服务器已关闭。原生 MCP 配置与保险库秘密保持不变。',
    vaultTitle: '凭据保险库', vaultNote: '插件专用 AES-256-GCM + scrypt 保险库，不是 Android Keystore。重启或超时会锁定。密码短语无法找回。锁定会清除插件内存并请求停止自有挂载，但无法确认远程关闭或撤销远程凭据。', passphrase: '密码短语（12–512 个字符）', initialize: '创建锁定的保险库', unlock: '解锁 5 分钟', lock: '锁定保险库／停止自有挂载', locked: '已锁定', unlocked: '已解锁（临时）', noSecrets: '没有已存储引用。', secretRef: '引用名称', secretValue: '新令牌或密码（仅写入）', secretFormat: '新值格式', raw: '密码／原始值', bearer: 'Bearer 令牌（自动添加前缀）', secretAction: '秘密操作', keepSecret: '保留已存储值，不会读取或发送秘密。', replaceSecret: '仅提交新值，绝不显示已保存秘密。', clearSecret: '删除此未使用的保险库秘密，不会撤销远程凭据。', saveSecret: '应用秘密更改', addSecret: '添加凭据', editSecret: '编辑凭据', deleteSecretTitle: '删除此未使用的秘密？', deleteSecretNote: '仅删除插件保险库内的值，不会撤销提供方的凭据。', referencedBy: '使用者', unused: '未被控制台服务器引用', inUse: '删除秘密前，请先从所有控制台配置中移除此引用。', secretsNote: '替换或清除凭据前，需停止所有控制台服务器并解锁保险库。切勿将秘密放入显示名称、地址、参数、路径或引用名称。输入已遮蔽，提交、锁定、重新连接或离开页面时会清除。',
    externalTitle: '原生 MCP 服务器 · 未管理', externalNote: '仅列出当前已挂载的原生命名空间，不是全部配置项。现有原生配置不由此控制台管理：不会复制、导入、编辑、停止或删除。', unavailable: '原生清单不可用。', externalEmpty: '没有可见的外部已挂载命名空间。', serviceTitle: 'MCP 控制台服务不可用', serviceNote: '请检查此插件后端在当前配置中是否启用，以及主机连接是否就绪，然后刷新。原生 MCP 配置保持不变。',
    error: '无法确认操作。重试前请刷新状态。为保护凭据，外部诊断信息已隐藏。', conflict: '配置已更改。重试前请刷新并检查。', owner: '仅已通过认证的主机所有者可使用此控制台。', success: '已完成。', kept: '已保留凭据，没有发送更改。', stoppingNote: '停止失败或关闭未验证。重启或撤销凭据前，请检查服务器本身。',
    token: '令牌（可选）', tokenNote: '仅粘贴令牌，系统会自动添加 Authorization: Bearer。也可将令牌留空，在下方请求头中输入完整 Authorization 值。已保存项留空时会保留原值。', tokenLocked: '现在即可输入。保存新值需要明确创建或解锁加密保险库。', tokenMounted: '此后端要求先停用全部控制台服务器，才能保存新的令牌或请求头值。不会自动停止服务器。', tokenAuth: '高级认证', tokenAuthNote: '请选择此服务器要求的格式。MCP 没有统一的认证方案。', tokenMode: '令牌请求头', tokenBearer: 'Authorization: Bearer（默认）', tokenApiKey: 'X-API-Key（原始值）', tokenAuthToken: 'X-Auth-Token（原始值）', tokenCustom: '自定义请求头', tokenCustomFormat: '自定义令牌格式', advancedHeaders: '高级 HTTP 请求头映射', advancedVault: '高级保险库凭据', addHeader: '添加请求头', removeHeader: '删除请求头映射', customHeader: '自定义…', selectHeader: '选择请求头', tokenPending: '部分加密凭据已单独保存，但服务器保存尚未确认。重试会先检查已保存状态。没有覆盖旧凭据或删除保险库秘密。', tokenUncertain: '部分凭据写入无法确认。剩余输入值已清除。重试会先检查保险库与已保存服务器，仅保留引用和状态。', tokenMissing: '请重新输入缺失凭据的值后保存。现有加密凭据会保留，新值将使用不同的新引用。', retryTokenSave: '核对／保存并启用', headers: '请求头（可选）', headerValue: '请求头值', headerValueNote: '请输入准确值，包括需要的 Bearer 前缀。留空可保留现有已保存值。值会加密，且不会再次显示。', headerRenameNote: '更改已保存请求头名称时必须重新输入值；不会自动移动不透明的已保存凭据。',
    editorVaultTitle: '保存前加密这些凭据', editorVaultNote: '请输入您自己的密码短语（12–512 个字符）。此操作仅创建／解锁保险库，令牌和请求头值仍留在字段中。然后点击保存。创建／解锁本身不会启用服务器。', createAndUnlock: '创建并解锁保险库', editorUnlock: '解锁保险库', editorVaultReady: '保险库已就绪。点击保存并启用，以加密凭据、验证连接并同步工具。', tokenAndHeaders: '令牌与请求头', automaticSecurity: '已保存凭据安全', automaticSecurityNote: '新值使用应用私有文件中的密钥自动加密，不是 Android Keystore。Root 或同一应用进程中的代码可访问该密钥。此控制台绝不显示或返回已保存值。留空可保留现有凭据。保存会验证并启用服务器；凭据存储与连接验证是独立步骤。', legacyVault: '旧式密码保险库（高级）', savedAuthentication: '认证已保存；令牌留空可保留。', savedHeaderValue: '值已保存；留空可保留。', reloadAutomaticHost: '请重新加载更新后的 MCP 控制台插件以自动保存凭据。已输入的值仍在此处，不会创建密码保险库或凭据。',
    saveActivationNote: '保存会验证并启用此服务器。可能运行 stdio 命令或连接地址、进行 MCP 握手并同步工具。仅已验证启用才视为成功。工具属于当前配置，可能被其中的会话共享。', integration: '集成与工具', integrationNote: '打开开关将授权运行已保存命令或连接地址并同步工具。开关显示最新快照中的应用内句柄，而非持续连接健康。关闭不会确认远程关闭或撤销凭据。', reloadSaveHost: '请重新加载更新后的 MCP 控制台插件以保存、验证并启用服务器。已输入的值仍在此处，不会写入凭据或连接服务器。', activationUnconfirmed: '匹配配置尚未确认已启用且工具同步已验证。没有重复启用。请检查已保存状态，然后明确点击保存并启用重试。', savePending: '保存与启用尚未确认。保存会先核对匹配配置与已验证启用状态，不会盲目重复启用。',
    serverInfo: '集成、状态与验证信息', verifying: '正在验证连接并同步工具', compactVerified: '已验证', compactUnknown: '未验证', compactDisabled: '已停用', compactMountFailed: '失败', compactStopFailed: '停止失败', compactShutdown: '已关闭 · 未确认', statusUnconfirmed: '最近连接操作尚未确认，较早的验证无法证明其结果。', reconnectAction: '重新连接并刷新 MCP 工具；可能再次运行已保存命令或连接 HTTP 服务器', dateLocale: 'zh-CN', targetEditBlocked: '请停用此 MCP 后再编辑。', appendSecretsNote: '为新服务器或未启用服务器保存新令牌与请求头值时，会使用新的加密引用，因此其他服务器可保持挂载。只要有控制台服务器挂载，就不能替换或删除现有保险库值。', reloadMountedSecretsHost: '请重新加载更新后的 MCP 控制台插件，以在其他服务器保持挂载时保存新的自动凭据。缺少此能力时保存被阻止，不会写入凭据或连接服务器，现有保险库值仍受保护。',
    persistentIntegrationNote: '开关显示跨 DSH 与插件重启保存的启用／停用偏好。启用授权后端在启动时恢复；连接状态独立显示。连接失败会保留启用偏好，请通过重新连接图标明确重试。关闭会保存停用，即使清理失败；可用同一图标重试停止保留的应用内句柄。', persistentStatusNote: '浏览器不会自动启动或重新连接。后端启动会恢复已保存的启用偏好，连接状态与验证结果仍独立显示。', notConnected: '未连接', compactNotConnected: '未连接', retryStopAction: '重试停止保留的应用内句柄；集成保持关闭，不会发起连接',
    policyRecoverOff: '确认关闭以恢复', policyRecoverOffNote: '工具策略需要恢复。请明确确认关闭，以保存停用偏好并停止保留的应用内句柄，即使开关已关闭。此操作不会撤销凭据或确认远程关闭。之后请刷新并检查，再明确重试策略。',
    advancedServer: '服务器高级设置', toolPolicy: '工具访问策略', policyManage: '管理工具访问', policyApply: '应用策略', policyMode: '访问模式', policyAll: '全部工具', policyInclude: '仅所选工具', policyExclude: '除所选外的全部工具', policyAllNote: '允许当前及新发现的所有工具。', policyIncludeNote: '仅允许已选中的准确名称。空选择不会开放任何工具，新发现的工具不会自动加入。', policyExcludeNote: '阻止已选中的准确名称。未列出的新工具仍被允许，空列表不阻止任何工具。', policyNamesNote: '选择使用准确、完整的公开工具名称，而非服务器显示名称或远端原始名称。缺失名称将一直保留，直到您明确取消选择。', policyLocalNote: '应用仅更改本地工具开放范围，不会停止／重启服务器、更改凭据、重新连接或发起 MCP／网络／工具调用。', policyUnavailable: '此后端不支持工具策略，不会发送策略更改。', policyNames: '公开工具名称', policySearch: '搜索公开名称', policyInventoryMounted: '名称来自当前已挂载清单。', policyInventoryKnown: '上次已知名称，不代表实时刷新工具。', policyInventoryUnavailable: '工具清单不可用。仅显示保留的选择，不会请求远端工具列表。', policyNewServer: '首次验证保存前，可选择“仅所选工具”并保持空选择，以不开放任何工具。保存仍会验证连接；之后再选择已验证的公开名称。', policyMissingName: '当前清单中不存在 · 已保留选择', policySelectionLimit: '已选名称 · 最多 512 个唯一名称', policyRefreshRequired: '再次应用前，请刷新并检查当前服务器状态。不会自动重复策略更新。', policyReview: '当前状态已刷新。请检查保留的选择，如仍需更改，请明确点击应用。', toolTimeout: '工具调用超时（秒）', toolTimeoutNote: '1–3600 的整数，默认 60。仅适用于工具调用，不适用于启动／握手。编辑配置前须停用此服务器。', timeoutUnavailable: '此后端不支持配置工具超时。',
    rpcDiagnostics: {
      'gateway/service-unavailable': '控制台后端服务不可用。', 'gateway/method-unavailable': '所请求的控制台方法不可用。', 'gateway/definition-unavailable': '控制台 RPC 定义不可用。', 'gateway/invocation-unavailable': 'RPC 调用不可用。', 'gateway/ambiguous-endpoint': '控制台 RPC 端点不明确。', 'gateway/input-invalid': '主机拒绝了控制台 RPC 输入。', 'gateway/result-invalid': '主机拒绝了控制台 RPC 结果。', 'gateway/binding-invalid': '控制台 RPC 绑定不兼容。', 'gateway/signature-invalid': '控制台 RPC 签名不兼容。', 'gateway/arguments-invalid': '控制台 RPC 参数不兼容。', 'gateway/internal': '网关内部错误阻止了此次请求。', 'remote-access/denied': '需要通过主机所有者认证。', 'uncategorized-transport': '主机连接无法完成此次请求。', 'uncategorized-rpc': 'RPC 请求失败，但没有已识别的诊断类别。', 'snapshot-contract-failed': '控制台响应与此前端不兼容。'
    },
    errors: {
      'credential-argument': '拒绝类似凭据的参数。请使用保险库环境变量引用。', 'vault-locked': '请先解锁保险库。', 'unsafe-url': '请使用无凭据、查询参数或片段的 HTTPS 或本机回环 HTTP。', 'invalid-input': '请检查必填字段、引用名称、数量限制及参数 JSON 语法。', 'invalid-url': '服务器地址无效。', 'invalid-headers': '请求头名称必须唯一（不区分大小写），不允许逐跳请求头。', 'vault-unlock-failed': '密码短语错误，或保险库无效／遭到篡改。', 'unlock-rate-limited': '解锁尝试过多，请等待 30 秒。', 'stop-before-edit': '编辑前请停止此服务器。', 'stop-before-delete': '删除前请停止此服务器。', 'stop-before-secret-change': '更改秘密前请停止所有控制台服务器。', 'secret-in-use': '请先从所有控制台配置中移除此引用。', 'secret-missing': '缺少被引用的秘密。请解锁保险库并创建引用。', 'mount-failed': '官方 MCP 子进程挂载失败，无法确认有效连接。', 'stop-failed': '自有子进程清理失败。请勿盲目重启；重试停止或卸载此插件。', 'store-busy': '其他写入者持有插件存储锁。', 'store-write-failed': '存储发布失败。请刷新检查已保存状态。', 'store-invalid': '插件存储无效，已拒绝操作。', 'revision-conflict': '配置已更改，请刷新并检查。', 'snapshot-contract-failed': '后端响应不兼容。请确认插件版本一致后刷新。', 'not-owned': '此服务器不属于当前配置中的控制台。', 'server-limit': '最多允许 32 个控制台服务器。', 'secret-limit': '最多允许 128 个保险库引用。', 'vault-exists': '保险库已存在，请刷新并解锁。', 'vault-not-initialized': '请先创建保险库。', 'disposed': '后端已卸载。请检查插件启用状态并刷新。',
      'authorization-ambiguous': '请使用令牌或已输入的 Authorization 请求头值，不能同时使用。', 'header-reentry-required': '更改已保存请求头名称时，请重新输入值或保留原名称。', 'vault-key-unavailable': '应用私有凭据密钥不可用。不会生成替代密钥或退回明文存储。', 'automatic-mode': '凭据自动处理，无需手动操作保险库。', 'secure-random-unavailable': '安全的 128 位随机源不可用，没有写入凭据。', 'save-cleanup-required': '验证未成功且清理无法确认，没有添加服务器配置。请勿盲目重试启用，先卸载此控制台插件以清理保留句柄。', 'save-state-ambiguous': '无法证明或恢复已保存状态。明确授权再次保存并启用前，请刷新并核对；不会自动重试启用。', 'append-secrets-upgrade-required': '缺少挂载期间追加新凭据的能力。请重新加载更新后的 MCP 控制台插件；此保存不会写入凭据或连接服务器，现有保险库值仍受保护。', 'secret-state-ambiguous': '此前凭据写入结果不确定，已阻止后续凭据更改及带凭据启用。请解决插件存储写入锁，然后仅重新加载此 MCP 控制台插件。重载可能清理或恢复明确启用的服务器，但不会自动重复凭据写入。', 'preference-state-ambiguous': '无法确认已保存的启用／停用偏好。如可用，请明确关闭或重试停止。否则请解决存储写入锁，再仅重新加载后端 MCP 控制台插件；刷新页面不会解除隔离状态。',
      'connection-auth-denied': '服务器拒绝认证或授权，请检查已保存的凭据引用。', 'connection-endpoint-unavailable': 'MCP 端点不可用或未找到。', 'connection-rate-limited': '服务器限制了连接频率，请等待后明确重试。', 'connection-service-unavailable': '远程服务暂时不可用。', 'connection-timeout': 'MCP 连接超时。', 'connection-refused': '端点拒绝连接。', 'connection-unreachable': '无法连接到服务器。', 'connection-tls-failed': 'TLS 安全连接失败。', 'connection-invalid-response': '服务器返回了无效 MCP 响应。', 'tool-policy-unavailable': '此后端不支持工具策略，不会发送策略更改。', 'tool-policy-apply-failed': '无法应用工具策略。重试前请刷新并检查。', 'tool-policy-state-ambiguous': '工具策略状态不确定。明确重试前请刷新并检查，不会自动重复更改。', 'invalid-tool-policy': '使用 all／include／exclude，最多 512 个本服务器命名空间内唯一的准确公开名称（ASCII，最多 64 个字符）。all 模式必须使用空列表。', 'tool-inventory-limit': '工具清单超过安全限制，不会显示超出限制的名称。', 'invalid-tool-timeout': '工具超时必须为 1–3600 秒的整数。', 'timeout-unavailable': '此后端不支持配置工具超时。'
    }
  };
  // Exact reviewed SDK gateway enum only. Return the literal catalog entry, not
  // the upstream string; unknown codes/messages/provider data never reach UI/logs.
  const rpcCategories = ['gateway/service-unavailable', 'gateway/method-unavailable', 'gateway/definition-unavailable', 'gateway/invocation-unavailable', 'gateway/ambiguous-endpoint', 'gateway/input-invalid', 'gateway/result-invalid', 'gateway/binding-invalid', 'gateway/signature-invalid', 'gateway/arguments-invalid', 'gateway/internal', 'remote-access/denied'];
  const safeRpcCategory = (code, fallback) => rpcCategories.find((known) => known === code) ?? fallback;
  // Never invoke getters or inherited provider properties to classify failures.
  const ownData = (object, key) => { try { return object && (typeof object === 'object' || typeof object === 'function') ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined; } catch { return undefined; } };
  const fixedConsoleCode = (error) => { const message = ownData(error, 'message'), match = typeof message === 'string' && /^MCP console: ([a-z-]+)$/.exec(message); return match && Object.hasOwn(en.errors, match[1]) ? match[1] : 'operation-failed'; };
  function localeDictionary(copy) {
    // Native LocaleService performs exact flat-key lookup, not nested traversal.
    // Keep the internal error maps for sanitization but publish only string keys.
    const { errors, rpcDiagnostics, ...labels } = copy;
    return { ...labels, ...Object.fromEntries(Object.entries(errors).map(([key, value]) => ['errors.' + key, value])), ...Object.fromEntries(Object.entries(rpcDiagnostics).map(([key, value]) => ['rpcDiagnostics.' + key, value])) };
  }
  /* Official MCP mark: first three unmodified paths from
   * https://github.com/modelcontextprotocol/docs/blob/main/logo/light.svg
   * (Git blob 2ecc0dd1b08f1eda0e159ea31c364b209f9cb6f3); adapted to an inline
   * SVG mask with a square mark-only canvas. No image/network request is made.
   * https://github.com/modelcontextprotocol/docs/blob/main/LICENSE
   * MIT License — Copyright (c) 2024–2025 Anthropic, PBC and contributors
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   * The above copyright notice and this permission notice shall be included in all
   * copies or substantial portions of the Software.
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  const mcpMark = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 195 195" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"><path d="M25 97.8528L92.8823 29.9706C102.255 20.598 117.451 20.598 126.823 29.9706V29.9706C136.196 39.3431 136.196 54.5391 126.823 63.9117L75.5581 115.177"/><path d="M76.2653 114.47L126.823 63.9117C136.196 54.5391 151.392 54.5391 160.765 63.9117L161.118 64.2652C170.491 73.6378 170.491 88.8338 161.118 98.2063L99.7248 159.6C96.6006 162.724 96.6006 167.789 99.7248 170.913L112.331 183.52"/><path d="M109.853 46.9411L59.6482 97.1457C50.2757 106.518 50.2757 121.714 59.6482 131.087V131.087C69.0208 140.459 84.2168 140.459 93.5894 131.087L143.794 80.8822"/></svg>';
  const McpHeadingMark = () => h('svg', { width: 20, height: 20, viewBox: '0 0 195 195', fill: 'none', stroke: 'currentColor', strokeWidth: 12, strokeLinecap: 'round', 'aria-hidden': true, focusable: 'false', style: { verticalAlign: '-3px', marginRight: 8 } }, ...[...mcpMark.matchAll(/<path d="([^"]+)"/g)].map(([, d], key) => h('path', { d, key })));
  // The same design tokens used by native Models; primitives own button, checkbox,
  // modal focus trapping, Escape, portal positioning, and focus restoration.
  const css = `
.personal-mcp-console{box-sizing:border-box;max-width:760px;min-width:0;width:100%;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.personal-mcp-console h2{margin:0;font-size:18px;font-weight:600;line-height:26px}.personal-mcp-console h3{margin:0;font-size:15px;font-weight:500;line-height:22px}.personal-mcp-console p{margin:0;overflow-wrap:anywhere}
.personal-mcp-console .mcp-muted{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}.personal-mcp-console .mcp-notice{color:var(--dsw-alias-state-success-primary)}.personal-mcp-console .mcp-error{color:var(--dsw-alias-state-warn-label)}
.personal-mcp-console .mcp-card{box-sizing:border-box;min-width:0;display:flex;flex-direction:column;gap:12px;border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);padding:14px}
.personal-mcp-console fieldset{min-width:0;margin:0;border:0;padding:0}.personal-mcp-console legend{padding:0;margin-bottom:10px;font-size:15px;font-weight:500}.personal-mcp-console .mcp-fields{display:flex;flex-direction:column;gap:12px}
.personal-mcp-console .mcp-actions,.personal-mcp-console .mcp-head{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.personal-mcp-console .mcp-head{justify-content:space-between}.personal-mcp-console .mcp-actions>*{min-height:40px}.personal-mcp-console .mcp-actions [data-danger]{color:var(--dsw-alias-state-error-primary)}
.personal-mcp-console .mcp-integration{display:flex;align-items:center;min-height:44px;margin-left:auto;flex:none}.personal-mcp-console .mcp-integration>label{min-height:44px}
.personal-mcp-console .mcp-compact-row{position:relative;display:flex;align-items:center;flex-wrap:nowrap;gap:4px;min-width:0}.personal-mcp-console .mcp-server-name{flex:0 1 auto;min-width:0;max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.personal-mcp-console .mcp-compact-row>.mcp-status{overflow:hidden;white-space:nowrap}.personal-mcp-console .mcp-row-icon{display:flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;min-width:44px;min-height:44px;padding:0;border:0;background:transparent;box-shadow:none}.personal-mcp-console .mcp-info{display:flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;min-width:44px;height:44px;min-height:44px}.personal-mcp-console .mcp-info-bubble{--mcp-info-max-width:340px;--mcp-info-max-height:360px;position:absolute;z-index:2;inset:auto;margin:0;box-sizing:border-box;min-width:0;min-height:0;max-width:var(--mcp-info-max-width);max-height:min(50vh,var(--mcp-info-max-height));display:none;overflow:auto;overscroll-behavior:contain;padding:0;border:1px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill);color:inherit;font:inherit;box-shadow:0 4px 16px #0003}.personal-mcp-console .mcp-info-bubble::backdrop{background:transparent;pointer-events:none}.personal-mcp-console .mcp-info-content{box-sizing:border-box;min-width:0;padding:12px;display:flex;flex-direction:column;gap:10px}.personal-mcp-console .mcp-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.personal-mcp-console .mcp-status-copy{min-width:0;display:flex;align-items:center;gap:4px;overflow:hidden}.personal-mcp-console .mcp-status-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.personal-mcp-console .mcp-verified-time{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}.personal-mcp-console .mcp-status-symbol{flex:none;width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center}.personal-mcp-console .mcp-spinner{box-sizing:border-box;border:2px solid #888;border-right-color:transparent;border-radius:50%;animation:personal-mcp-spin .8s linear infinite;color:#888}.personal-mcp-console .mcp-status[data-state="verifying"]{color:var(--dsw-alias-label-secondary)}
@keyframes personal-mcp-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.personal-mcp-console .mcp-spinner{animation:none;border-right-color:#888;border-style:dotted}}
.personal-mcp-console .mcp-field{display:flex;flex-direction:column;gap:6px;min-width:0}.personal-mcp-console .mcp-field-label{font-size:13px;color:var(--dsw-alias-label-secondary)}
.personal-mcp-console input:not([type="checkbox"]):not([type="radio"]),.personal-mcp-console select,.personal-mcp-console textarea{box-sizing:border-box;width:100%;min-width:0;max-width:100%;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill);color:var(--dsw-alias-label-primary);font:inherit;min-height:40px;padding:9px 10px}
.personal-mcp-console textarea{resize:vertical;min-height:76px}.personal-mcp-console input:focus-visible,.personal-mcp-console select:focus-visible,.personal-mcp-console textarea:focus-visible,.personal-mcp-console summary:focus-visible,.personal-mcp-console .mcp-info-bubble:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.personal-mcp-console :disabled{opacity:.55;cursor:not-allowed}.personal-mcp-console .mcp-rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}.personal-mcp-console .mcp-tag{font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);padding:1px 6px;overflow-wrap:anywhere}
.personal-mcp-console .mcp-server{gap:6px}.personal-mcp-console .mcp-status{display:inline-flex;align-items:center;gap:4px;flex:1;min-width:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}.personal-mcp-console .mcp-status[data-state="activation-verified"]{color:var(--dsw-alias-state-success-primary)}.personal-mcp-console .mcp-status[data-state="mount-failed"],.personal-mcp-console .mcp-status[data-state="stop-failed"]{color:var(--dsw-alias-state-error-primary)}
.personal-mcp-console .mcp-type-choice{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.personal-mcp-console .mcp-type-choice>*{min-height:48px;white-space:normal}.personal-mcp-console .mcp-type-choice [aria-pressed="true"],.personal-mcp-console .mcp-actions [data-primary]{color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}.personal-mcp-console .mcp-disclosure>p,.personal-mcp-console .mcp-disclosure>.mcp-detail,.personal-mcp-console .mcp-disclosure>.mcp-actions{margin-top:10px}.personal-mcp-console .mcp-disclosure>.mcp-inline-editor{margin-top:12px}.personal-mcp-console .mcp-empty{padding:24px 14px}
.personal-mcp-console .mcp-mapping{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;border-top:.5px solid var(--dsw-alias-border-l3);padding-top:10px}.personal-mcp-console .mcp-wide{grid-column:1/-1}.personal-mcp-console .mcp-detail{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;margin:0}.personal-mcp-console dt{color:var(--dsw-alias-label-tertiary)}.personal-mcp-console dd{margin:0;overflow-wrap:anywhere}.personal-mcp-console summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}.personal-mcp-console code{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.personal-mcp-console .mcp-danger{color:var(--dsw-alias-state-error-primary)}
.personal-mcp-console .mcp-tool-policy{margin-top:10px}.personal-mcp-console .mcp-tool-names{max-height:320px;overflow:auto;overscroll-behavior:contain;gap:4px}.personal-mcp-console .mcp-tool-names>li{min-width:0;display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere;word-break:break-word}
/* Checkbox is the native label > input + span primitive, not a text field.
   Keep its indicator small while the entire named row remains touchable. */
.personal-mcp-console .mcp-tool-choice{box-sizing:border-box;display:grid;grid-template-columns:18px minmax(0,1fr);align-items:start;gap:8px;width:100%;max-width:100%;min-width:0;min-height:44px;padding:6px 0;cursor:pointer}.personal-mcp-console .mcp-tool-choice>input[type="checkbox"]{box-sizing:border-box;flex:none;width:18px;min-width:18px;max-width:18px;height:18px;min-height:18px;max-height:18px;padding:0;margin:1px 0 0}.personal-mcp-console .mcp-tool-choice>span{min-width:0;max-width:100%;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);white-space:normal;overflow-wrap:anywhere;word-break:break-word}
.personal-mcp-console .mcp-header-action{min-width:44px;min-height:44px}.personal-mcp-console .mcp-http-header{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:10px;border-top:.5px solid var(--dsw-alias-border-l3);padding-top:10px}
.personal-mcp-console .mcp-header-caption{display:flex;justify-content:flex-start;align-items:center;min-height:44px;gap:8px}.personal-mcp-console .mcp-header-caption>.mcp-header-trash{display:flex;align-items:center;justify-content:center;flex:0 0 44px;width:44px;min-width:44px;min-height:44px;padding:0;border:0;background:transparent;box-shadow:none}.personal-mcp-console .mcp-http-header>label>.mcp-field-label{min-height:44px;display:flex;align-items:center}.personal-mcp-console .mcp-inline-vault{border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);padding:12px}
@media(max-width:560px){.personal-mcp-console .mcp-http-header{grid-template-columns:minmax(0,1fr)}.personal-mcp-console .mcp-http-header>label{grid-column:1}.personal-mcp-console .mcp-mapping{grid-template-columns:minmax(0,1fr)}.personal-mcp-console .mcp-actions>*{flex:1 1 135px;min-height:44px}.personal-mcp-console .mcp-detail{grid-template-columns:minmax(0,1fr);gap:2px}.personal-mcp-console dd{margin-bottom:6px}.personal-mcp-console .mcp-card{padding:12px}}
`;
  const validRect = (rect) => rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top;
  function infoViewport(width, height, visual) {
    const rect = { left: 0, top: 0, right: width, bottom: height };
    if (!validRect(rect)) return null;
    if (visual && [visual.offsetLeft, visual.offsetTop, visual.width, visual.height].every(Number.isFinite) && visual.width > 0 && visual.height > 0) {
      rect.left = Math.max(rect.left, visual.offsetLeft); rect.top = Math.max(rect.top, visual.offsetTop);
      rect.right = Math.min(rect.right, visual.offsetLeft + visual.width); rect.bottom = Math.min(rect.bottom, visual.offsetTop + visual.height);
    }
    return validRect(rect) ? rect : null;
  }
  function infoBounds(viewport, content, clips = []) {
    if (!validRect(viewport) || !validRect(content)) return null;
    // The owned compact row bounds the width (excluding card padding); vertical
    // space comes from the visible scrolling area, not the short card itself.
    const rect = { ...viewport, left: Math.max(viewport.left, content.left), right: Math.min(viewport.right, content.right) };
    for (const clip of clips) {
      if (!validRect(clip.rect)) return null;
      if (clip.x) { rect.left = Math.max(rect.left, clip.rect.left); rect.right = Math.min(rect.right, clip.rect.right); }
      if (clip.y) { rect.top = Math.max(rect.top, clip.rect.top); rect.bottom = Math.min(rect.bottom, clip.rect.bottom); }
    }
    // Keep the border/focus edge off the clipping boundary, independent of device.
    rect.left += 4; rect.right -= 4; rect.top += 4; rect.bottom -= 4;
    return validRect(rect) ? rect : null;
  }
  function infoGeometry(anchor, bounds, contentHeight = Infinity, limits = {}) {
    if (!validRect(anchor) || !validRect(bounds) || anchor.right <= bounds.left || anchor.left >= bounds.right || anchor.bottom <= bounds.top || anchor.top >= bounds.bottom) return null;
    const belowTop = Math.max(bounds.top, Math.min(bounds.bottom, anchor.bottom));
    const aboveBottom = Math.max(bounds.top, Math.min(bounds.bottom, anchor.top));
    const below = bounds.bottom - belowTop, above = aboveBottom - bounds.top;
    const desired = Math.min(Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : Infinity, Number.isFinite(limits.height) && limits.height > 0 ? limits.height : Infinity);
    const placement = desired <= below || below >= above ? 'below' : 'above';
    const height = Math.min(desired, placement === 'below' ? below : above);
    const width = Math.min(bounds.right - bounds.left, Number.isFinite(limits.width) && limits.width > 0 ? limits.width : Infinity);
    if (height < 2 || width < 2) return null;
    const left = Math.max(bounds.left, Math.min(anchor.left, bounds.right - width));
    return { left, top: placement === 'below' ? belowTop : aboveBottom - height, width, height, placement };
  }
  function absoluteInfoGeometry(geometry, parent) {
    if (!geometry || !validRect(parent?.rect) || !(parent.width > 0) || !(parent.height > 0)) return null;
    const scaleX = (parent.rect.right - parent.rect.left) / parent.width, scaleY = (parent.rect.bottom - parent.rect.top) / parent.height;
    const left = parent.rect.left + (parent.clientLeft - parent.scrollLeft) * scaleX;
    const top = parent.rect.top + (parent.clientTop - parent.scrollTop) * scaleY;
    const result = { left: (geometry.left - left) / scaleX, top: (geometry.top - top) / scaleY, width: geometry.width / scaleX, height: geometry.height / scaleY };
    return Object.values(result).every(Number.isFinite) ? result : null;
  }
  function infoClientRect(node) {
    const rect = node?.getBoundingClientRect?.();
    if (!validRect(rect)) return null;
    const scaleX = node.offsetWidth > 0 ? (rect.right - rect.left) / node.offsetWidth : 1;
    const scaleY = node.offsetHeight > 0 ? (rect.bottom - rect.top) / node.offsetHeight : 1;
    const left = rect.left + (node.clientLeft ?? 0) * scaleX, top = rect.top + (node.clientTop ?? 0) * scaleY;
    return { left, top, right: left + (node.clientWidth ?? rect.right - rect.left) * scaleX, bottom: top + (node.clientHeight ?? rect.bottom - rect.top) * scaleY };
  }
  function infoClippingAncestors(trigger, owner, view) {
    const ancestors = [];
    // Root overflow participates in the viewport, not the body's content box.
    // A portal-only SPA can have a zero-height body and fully visible fixed UI.
    for (let node = trigger.parentElement; node && node !== owner.body && node !== owner.documentElement; node = node.parentElement) ancestors.push({ node, style: view.getComputedStyle?.(node) });
    const fixedContainer = (style) => style && (['transform', 'perspective', 'filter', 'backdropFilter'].some((key) => style[key] && style[key] !== 'none') || /(?:^|\s)(?:layout|paint|content|strict)(?:\s|$)/.test(style.contain ?? '') || /(?:^|[,\s])(?:transform|perspective|filter|backdrop-filter)(?:[,\s]|$)/.test(style.willChange ?? '') || style.contentVisibility === 'auto');
    const relevant = [];
    for (let i = 0; i < ancestors.length; i++) {
      const entry = ancestors[i]; relevant.push(entry);
      if (entry.style?.position !== 'fixed') continue;
      // A viewport-fixed overlay escapes overflow on unrelated portal ancestors.
      // If an ancestor establishes its fixed containing block, resume there;
      // boxes between the fixed element and that containing block do not clip it.
      const container = ancestors.findIndex(({ style }, index) => index > i && fixedContainer(style));
      if (container < 0) break;
      i = container - 1;
    }
    return relevant;
  }
  function installInfoGeometry(trigger, popup, focusGuard) {
    if (!trigger || !popup) return { position: () => {}, dispose: () => {} };
    const owner = trigger.ownerDocument ?? document, view = owner.defaultView ?? window;
    let topLayer = typeof popup.showPopover === 'function' && typeof popup.hidePopover === 'function', shown = false, disposed = false;
    const hide = () => {
      popup.style.display = 'none';
      if (shown) {
        // Native popover dismissal may synchronously restore trigger focus. That
        // focus must not turn a just-closed popup back into transient hover info.
        const previous = focusGuard.current; focusGuard.current = true;
        try { popup.hidePopover(); } catch {} finally { focusGuard.current = previous; shown = false; }
      }
    };
    const position = (event) => {
      if (disposed || (event?.target && popup.contains(event.target))) return;
      const scrollTop = popup.scrollTop, scrollLeft = popup.scrollLeft;
      const content = trigger.closest?.('.mcp-compact-row'), clips = [];
      for (const { node, style } of infoClippingAncestors(trigger, owner, view)) {
        if (!style) continue;
        const paint = /(?:^|\s)(?:paint|content|strict)(?:\s|$)/.test(style.contain ?? '');
        const x = paint || /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX), y = paint || /^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY);
        if (x || y) clips.push({ rect: infoClientRect(node), x, y });
      }
      const viewport = infoViewport(owner.documentElement?.clientWidth || view.innerWidth, owner.documentElement?.clientHeight || view.innerHeight, view.visualViewport);
      const bounds = infoBounds(viewport, infoClientRect(content), clips), anchor = infoClientRect(trigger);
      const style = view.getComputedStyle?.(popup);
      // Preserve the existing own CSS maximums, but shrink to actual visible
      // content/clip bounds. No device width or native Settings class is assumed.
      const width = parseFloat(style?.getPropertyValue?.('--mcp-info-max-width'));
      const height = parseFloat(style?.getPropertyValue?.('--mcp-info-max-height'));
      const limits = { width, height: Math.min(Number.isFinite(height) && height > 0 ? height : Infinity, viewport ? (viewport.bottom - viewport.top) / 2 : 0) };
      let geometry = infoGeometry(anchor, bounds, Infinity, limits);
      if (!geometry) { hide(); return; }
      // Mount hidden and bounded, then measure at the final width. The JSX starts
      // display:none, and this runs in a layout effect: no unbounded initial paint.
      Object.assign(popup.style, { visibility: 'hidden', display: 'block', position: topLayer ? 'fixed' : 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', maxWidth: '0px', maxHeight: '0px' });
      if (topLayer) Object.assign(popup.style, { left: geometry.left + 'px', top: geometry.top + 'px', width: geometry.width + 'px', height: geometry.height + 'px', maxWidth: geometry.width + 'px', maxHeight: geometry.height + 'px' });
      if (topLayer && !shown) {
        popup.setAttribute('popover', 'manual');
        try { popup.showPopover(); shown = true; }
        catch { topLayer = false; popup.removeAttribute('popover'); Object.assign(popup.style, { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', maxWidth: '0px', maxHeight: '0px' }); }
      }
      if (!topLayer) popup.removeAttribute('popover');
      const parent = !topLayer && (popup.offsetParent ?? trigger.closest?.('.mcp-compact-row'));
      const parentBox = parent && { rect: parent.getBoundingClientRect(), width: parent.offsetWidth, height: parent.offsetHeight, clientLeft: parent.clientLeft ?? 0, clientTop: parent.clientTop ?? 0, scrollLeft: parent.scrollLeft ?? 0, scrollTop: parent.scrollTop ?? 0 };
      const apply = (next) => {
        const box = topLayer ? next : absoluteInfoGeometry(next, parentBox);
        if (!box) return false;
        Object.assign(popup.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px', maxWidth: box.width + 'px', maxHeight: box.height + 'px' });
        return true;
      };
      if (!apply(geometry)) { hide(); return; }
      const scaleY = topLayer ? 1 : (parentBox.rect.bottom - parentBox.rect.top) / parentBox.height;
      const contentHeight = ((popup.firstElementChild?.scrollHeight ?? popup.scrollHeight) + 2) * scaleY;
      geometry = infoGeometry(anchor, bounds, contentHeight, limits);
      if (!geometry || !apply(geometry)) { hide(); return; }
      popup.style.visibility = 'visible'; popup.scrollTop = scrollTop; popup.scrollLeft = scrollLeft;
    };
    position();
    owner.addEventListener('scroll', position, true);
    view.addEventListener?.('resize', position);
    view.visualViewport?.addEventListener('resize', position);
    view.visualViewport?.addEventListener('scroll', position);
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(position) : null;
    if (observer) {
      // Observe content and ancestor boxes, not our positioned bubble (which could
      // otherwise feed its own geometry changes back into ResizeObserver).
      if (popup.firstElementChild) observer.observe(popup.firstElementChild);
      for (let node = trigger; node; node = node.parentElement) observer.observe(node);
    }
    return { position, dispose: () => {
      disposed = true; observer?.disconnect(); hide();
      owner.removeEventListener('scroll', position, true);
      view.removeEventListener?.('resize', position);
      view.visualViewport?.removeEventListener('resize', position);
      view.visualViewport?.removeEventListener('scroll', position);
    } };
  }
  const automaticVault = (vault) => vault?.mode === 'automatic';
  const oldHostNeedsReload = (vault) => !vault?.mode && !vault?.initialized;
  const requiresVaultUnlock = (vault) => !automaticVault(vault) && (!vault.initialized || vault.locked || vault.expiresAt <= Date.now());
  const activeState = (state) => state === 'activation-verified' || state === 'mounted-status-unavailable' || state === 'stop-failed';
  const supportsValidatedSave = (snapshot) => snapshot?.capabilities?.saveAndActivate === true && Boolean(schemas.saveAndActivate);
  const supportsToolPolicy = (snapshot) => snapshot?.capabilities?.toolPolicy === true && Boolean(schemas.setToolPolicy);
  const supportsTimeout = (snapshot) => snapshot?.capabilities?.configurableTimeout === true;
  const dateLocale = (t) => ['pt-BR', 'zh-CN'].includes(t('dateLocale')) ? t('dateLocale') : 'en';
  const effectivePolicy = (config) => config?.toolPolicy ?? { mode: 'all', names: [] };
  const policyRecoveryNeeded = (row) => row?.lastFailure === 'tool-policy-state-ambiguous' || row?.lastFailure === 'tool-policy-apply-failed';
  const policyKey = (policy) => JSON.stringify({ mode: policy.mode, names: [...policy.names].sort() });
  function checkedPolicy(policy, serverId) {
    if (!policy || !['all', 'include', 'exclude'].includes(policy.mode) || !Array.isArray(policy.names) || policy.names.length > 512 || new Set(policy.names).size !== policy.names.length || (policy.mode === 'all' && policy.names.length)) throw { consoleCode: 'invalid-tool-policy' };
    if (policy.names.some((name) => typeof name !== 'string' || name.length > 64 || !/^mcp__pc_[a-f0-9]{24}__[A-Za-z0-9_-]+$/.test(name) || (serverId && !name.startsWith('mcp__pc_' + serverId + '__')))) throw { consoleCode: 'invalid-tool-policy' };
    return { mode: policy.mode, names: [...policy.names] };
  }
  const provenConnectionFailures = new Set(['mount-failed', 'connection-auth-denied', 'connection-endpoint-unavailable', 'connection-rate-limited', 'connection-service-unavailable', 'connection-timeout', 'connection-refused', 'connection-unreachable', 'connection-tls-failed', 'connection-invalid-response']);
  // Neither a mounted handle nor a truthy future/invalid capability is a saved
  // startup preference. Old snapshots keep their conservative mounted fallback.
  const persistentRow = (snapshot, row) => snapshot?.capabilities?.persistentActivation === true && typeof row?.enabled === 'boolean';
  const integrationChecked = (snapshot, row) => persistentRow(snapshot, row) ? row.enabled : activeState(row?.state);
  const recoveryMethod = (snapshot, row) => persistentRow(snapshot, row) ? row.enabled ? 'reconnect' : activeState(row.state) ? 'stop' : null : activeState(row?.state) ? 'reconnect' : null;
  const activationGuard = (snapshot, row) => ({ capability: snapshot?.capabilities?.persistentActivation, enabled: row?.enabled, state: row?.state });
  const sameActivationGuard = (guard, snapshot, row) => guard.capability === snapshot?.capabilities?.persistentActivation && guard.enabled === row?.enabled && guard.state === row?.state;
  // Only this explicit automatic-mode contract permits APPENDING fresh aliases.
  // It never authorizes overwriting/deleting existing refs or editing a mount.
  const supportsMountedSecretAppend = (snapshot) => automaticVault(snapshot?.vault) && snapshot?.capabilities?.appendSecretsWhileMounted === true;
  const hasMountedServers = (snapshot) => snapshot?.servers.some(({ state }) => activeState(state)) ?? false;
  const validVerificationTime = (value) => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
  const verifiedActivation = (row, snapshot) => row?.state === 'activation-verified' && validVerificationTime(row.lastVerifiedAt) && integrationChecked(snapshot, row);
  function VerificationTime({ value, t }) {
    const date = validVerificationTime(value) ? new Date(value) : undefined;
    const locale = dateLocale(t);
    const full = date?.toLocaleString(locale);
    return date ? h('time', { className: 'mcp-verified-time', dateTime: date.toISOString(), title: t('verifiedAt') + ': ' + full, 'aria-label': t('verifiedAt') + ': ' + full }, date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })) : h('span', { className: 'mcp-sr-only' }, t('verificationTimeUnavailable'));
  }
  const compactState = { 'activation-verified': 'compactVerified', 'mounted-status-unavailable': 'compactUnknown', disabled: 'compactDisabled', 'mount-failed': 'compactMountFailed', 'stop-failed': 'compactStopFailed', 'unmounted-shutdown-unverified': 'compactShutdown' };
  const stateSymbol = { 'activation-verified': '✓', 'mounted-status-unavailable': '?', disabled: '○', 'mount-failed': '×', 'stop-failed': '!', 'unmounted-shutdown-unverified': '○' };
  const commonHeaders = ['Authorization', 'X-API-Key', 'X-Auth-Token', 'X-Client-ID', 'X-Correlation-ID', 'X-Organization-ID', 'X-Request-ID'];
  const blockedHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-connection']);
  const protocolHeaders = new Set(['accept', 'content-type', 'keep-alive', 'te', 'trailer', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']);
  const validHeader = (name) => /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) && !blockedHeaders.has(name.toLowerCase());
  let headerSerial = 0;
  const headerId = () => 'header-' + (++headerSerial);
  const mappings = (refs = {}) => Object.entries(refs).map(([name, ref]) => ({ id: headerId(), name, ref, savedRef: ref, savedName: name, action: 'keep', custom: !commonHeaders.includes(name) }));
  function createServerDraft(config, revision) {
    return { id: config?.id, label: config?.label ?? '', transport: config?.transport ?? 'streamable-http', command: config?.command ?? '', args: JSON.stringify(config?.args ?? []), cwd: config?.cwd ?? '', url: config?.url ?? '', envRows: mappings(config?.envRefs), headerRows: mappings(config?.headerRefs), toolPolicy: { ...effectivePolicy(config), names: [...effectivePolicy(config).names] }, timeoutSeconds: String(Math.ceil((config?.toolCallTimeoutMs ?? 60000) / 1000)), _timeoutEdited: false, _policyEdited: false, _baseConfig: config, _revision: revision };
  }
  function freshTokenRef(refs) {
    if (typeof window.crypto?.getRandomValues !== 'function') throw { consoleCode: 'secure-random-unavailable' };
    for (let attempt = 0; attempt < 4; attempt++) {
      const bytes = new Uint8Array(16); window.crypto.getRandomValues(bytes);
      const ref = 'mcp_token_' + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (!refs.includes(ref)) return ref;
    }
    throw { consoleCode: 'secure-random-unavailable' };
  }
  const configKey = (config) => JSON.stringify(config, function (key, value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([name]) => key !== '' || name !== 'id').sort(([a], [b]) => a.localeCompare(b))) : value; });
  function serverFromDraft(draft) {
    const refs = Object.create(null), rows = draft.transport === 'stdio' ? draft.envRows : draft.headerRows;
    const names = new Set();
    for (const row of rows) {
      if (row.action === 'clear') continue;
      const name = row.name, key = draft.transport === 'stdio' ? name : name.toLowerCase();
      if (names.has(key)) throw { consoleCode: draft.transport === 'stdio' ? 'invalid-input' : 'invalid-headers' };
      if (draft.transport !== 'stdio' && ((row.action === 'keep' && row.savedName && row.savedName.toLowerCase() !== key) || !validHeader(name) || (protocolHeaders.has(key) && (row.savedName?.toLowerCase() !== key || row.action !== 'keep')))) throw { consoleCode: 'invalid-headers' };
      names.add(key); refs[name] = row.action === 'keep' ? row.savedRef : row.ref;
    }
    const policy = checkedPolicy(draft.toolPolicy?.mode === 'all' ? { mode: 'all', names: [] } : draft.toolPolicy ?? { mode: 'all', names: [] }, draft.id);
    const seconds = Number(draft.timeoutSeconds ?? '60');
    if (!/^\d+$/.test(draft.timeoutSeconds ?? '60') || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600) throw { consoleCode: 'invalid-tool-timeout' };
    const timeout = !draft._timeoutEdited && Object.hasOwn(draft._baseConfig ?? {}, 'toolCallTimeoutMs') ? draft._baseConfig.toolCallTimeoutMs : seconds * 1000;
    const common = { ...(draft.id ? { id: draft.id } : {}), label: draft.label, transport: draft.transport,
      ...(policy.mode !== 'all' || (!draft._policyEdited && Object.hasOwn(draft._baseConfig ?? {}, 'toolPolicy')) ? { toolPolicy: policy } : {}),
      ...(timeout !== 60000 || (!draft._timeoutEdited && Object.hasOwn(draft._baseConfig ?? {}, 'toolCallTimeoutMs')) ? { toolCallTimeoutMs: timeout } : {}) };
    const server = draft.transport === 'stdio' ? { ...common, command: draft.command, args: JSON.parse(draft.args), cwd: draft.cwd, envRefs: refs } : { ...common, url: draft.url, headerRefs: refs };
    if (!schemas.save.safeParse({ revision: draft._revision, server }).success) throw { consoleCode: 'invalid-input' };
    if (draft.transport === 'streamable-http') {
      let url; try { url = new URL(server.url); } catch { throw { consoleCode: 'invalid-url' }; }
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || /[\s\\]/.test(server.url)) throw { consoleCode: 'invalid-url' };
      server.url = url.href;
    }
    return server;
  }
  function ConfigDetails({ config, t, hideRefs = false }) {
    const entries = [['label', config.label], ['transport', t(config.transport === 'stdio' ? 'stdio' : 'http')], ...(config.transport === 'stdio' ? [['command', config.command], ['args', JSON.stringify(config.args)], ['cwd', config.cwd || '—']] : [['url', config.url]]), ...(hideRefs ? [] : [['refsTitle', JSON.stringify(config.envRefs ?? config.headerRefs ?? {})]])];
    return h('dl', { className: 'mcp-detail' }, ...entries.flatMap(([key, value]) => [h('dt', { key: key + '-label' }, t(key)), h('dd', { key }, h('code', null, value))]));
  }
  function Panel({ api, watch, t }) {
    const [snapshot, setSnapshot] = React.useState(null);
    const [loadFailed, setLoadFailed] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [notice, setNotice] = React.useState(null);
    const [editor, setEditor] = React.useState(null);
    const [secretEditor, setSecretEditor] = React.useState(null);
    const [confirmation, setConfirmation] = React.useState(null);
    const [acknowledged, setAcknowledged] = React.useState(false);
    const [vaultPrompt, setVaultPrompt] = React.useState(false);
    const [infoOpen, setInfoOpen] = React.useState(null);
    const [verifying, setVerifying] = React.useState(null);
    const [uncertain, setUncertain] = React.useState({});
    const [policyEditor, setPolicyEditor] = React.useState(null);
    const policyEditorRef = React.useRef(null), policyUncertain = React.useRef(new Set());
    policyEditorRef.current = policyEditor;
    const editPolicy = (next) => { policyEditorRef.current = typeof next === 'function' ? next(policyEditorRef.current) : next; setPolicyEditor(policyEditorRef.current); };
    const infoRoot = React.useRef(null), infoPopup = React.useRef(null), infoLayout = React.useRef(null), infoFocusGuard = React.useRef(false), observedLoadFailed = React.useRef(false);
    const root = React.useRef(null), passphraseInput = React.useRef(null), secretInput = React.useRef(null), tokenInput = React.useRef(null), editorPassphraseInput = React.useRef(null), observedSnapshot = React.useRef(null), headerInputs = React.useRef(new Map());
    const editorFirstField = React.useRef(null), editorFocusRequest = React.useRef(0);
    const alive = React.useRef(true), epoch = React.useRef(0), mutation = React.useRef(false), inputEpoch = React.useRef(0), editorVersion = React.useRef(0), editorRef = React.useRef(null);
    editorRef.current = editor;
    const editDraft = (next) => { const previous = editorRef.current; const draft = typeof next === 'function' ? next(previous) : next; if (previous && previous.transport !== draft?.transport) clearInputs(); if (typeof next !== 'function' || previous?.transport !== draft?.transport) { setVaultPrompt(false); if (editorPassphraseInput.current) editorPassphraseInput.current.value = ''; } editorVersion.current++; editorRef.current = draft; setEditor(draft); };
    const id = React.useId();
    React.useLayoutEffect(() => {
      // Opening Edit removes its button. Hand focus to the first field once;
      // draft typing, snapshots and pending reconciliation must not refocus it.
      if (editor) editorFirstField.current?.focus?.();
    }, [editorFocusRequest.current]);
    const clearInputs = React.useCallback(() => {
      // Stable refs also reach a field rendered through a native Modal portal.
      // Do not use a per-render callback ref: polling must not erase typed input.
      inputEpoch.current++;
      for (const input of [passphraseInput.current, editorPassphraseInput.current, secretInput.current, tokenInput.current, ...[...headerInputs.current.values()].map((ref) => ref.current)]) if (input) input.value = '';
      for (const input of root.current?.querySelectorAll('input[type="password"]') ?? []) input.value = '';
    }, []);
    const observeSnapshot = React.useCallback((next) => {
      // Initial/repeated locked polls must not erase values typed before setup.
      // A real unlocked -> locked/expired transition still invalidates ALL input.
      const previous = observedSnapshot.current;
      if (previous && !automaticVault(previous.vault) && !previous.vault.locked && requiresVaultUnlock(next.vault)) { clearInputs(); setSecretEditor(null); }
      observedSnapshot.current = next; observedLoadFailed.current = false; setSnapshot(next); setLoadFailed(false);
      setUncertain((previous) => Object.fromEntries(Object.entries(previous).filter(([serverId, oldTime]) => {
        const row = next.servers.find(({ config }) => config.id === serverId);
        // An unchanged old green snapshot cannot confirm an ambiguous reconnect.
        return row?.state === 'activation-verified' && row.lastVerifiedAt === oldTime;
      })));
      if (automaticVault(next.vault) || (!next.vault.locked && next.vault.expiresAt > Date.now())) { if (editorPassphraseInput.current) editorPassphraseInput.current.value = ''; setVaultPrompt(false); }
    }, [clearInputs]);
    const errorText = React.useCallback((error) => {
      const code = ownData(error, 'consoleCode');
      const message = code === 'owner-required' ? t('owner') : code === 'revision-conflict' ? t('conflict') : typeof code === 'string' && Object.hasOwn(en.errors, code) ? t('errors.' + code) : t('error');
      const category = ownData(error, 'rpcCategory');
      return typeof category === 'string' && Object.hasOwn(en.rpcDiagnostics, category) ? message + ' ' + t('rpcDiagnostics.' + category) + ' [' + category + ']' : message;
    }, [t]);
    const refresh = React.useCallback(async (reviewPolicy = false) => {
      if (mutation.current) return;
      const tick = ++epoch.current;
      try {
        const next = await api('snapshot', {});
        if (alive.current && tick === epoch.current && !mutation.current) {
          observeSnapshot(next);
          // Only an explicit Refresh reviews/rebases a policy draft. Polls are
          // read-only and never authorize replay of a lost/ambiguous update.
          if (reviewPolicy === true && supportsToolPolicy(next)) policyUncertain.current.clear();
          if (reviewPolicy === true && policyEditorRef.current) {
            const draft = policyEditorRef.current, row = next.servers.find(({ config }) => config.id === draft.id);
            if (row && supportsToolPolicy(next)) {
              const wanted = draft.mode === 'all' ? { mode: 'all', names: [] } : { mode: draft.mode, names: draft.names };
              if (!policyRecoveryNeeded(row) && draft._attempted && policyKey(effectivePolicy(row.config)) === policyKey(wanted) && configKey({ ...row.config, toolPolicy: undefined }) === configKey({ ...draft._baseConfig, toolPolicy: undefined }) && sameActivationGuard(draft._guard, next, row) && row.lastVerifiedAt === draft._verifiedAt) {
                editPolicy(null); setNotice({ text: t('success') });
              } else {
                editPolicy({ ...draft, _revision: next.revision, _baseConfig: row.config, _guard: activationGuard(next, row), _verifiedAt: row.lastVerifiedAt, _requiresRefresh: policyRecoveryNeeded(row), _attempted: false });
                setNotice({ text: t('policyReview') });
              }
            } else editPolicy({ ...draft, _requiresRefresh: true });
          }
        }
      } catch (error) {
        if (alive.current && tick === epoch.current) { observedLoadFailed.current = true; setLoadFailed(true); setNotice({ error: true, text: errorText(error) }); }
      }
    }, [api, errorText, observeSnapshot]);
    React.useEffect(() => {
      alive.current = true; void refresh();
      const unwatch = watch(() => {
        epoch.current++; clearInputs(); observedSnapshot.current = null; observedLoadFailed.current = false; setSnapshot(null); editDraft(null); setSecretEditor(null); setConfirmation(null); setInfoOpen(null); setVerifying(null); setUncertain({}); editPolicy(null); setNotice(null); setLoadFailed(false); void refresh();
      });
      const timer = setInterval(() => { if (!mutation.current) void refresh(); }, 15000);
      return () => { alive.current = false; epoch.current++; clearInputs(); clearInterval(timer); unwatch(); };
    }, [refresh, watch, clearInputs]);
    React.useLayoutEffect(() => {
      if (!infoOpen) return;
      const layout = installInfoGeometry(infoRoot.current, infoPopup.current, infoFocusGuard); infoLayout.current = layout;
      return () => { layout.dispose(); if (infoLayout.current === layout) infoLayout.current = null; };
    }, [infoOpen?.id]);
    // Polling can change the note's text, but must not hide/reopen the native
    // popover and steal keyboard focus or discard its current scroll position.
    React.useLayoutEffect(() => { infoLayout.current?.position(); }, [snapshot]);
    React.useEffect(() => {
      if (!infoOpen) return;
      const outside = (event) => { if (!infoRoot.current?.contains(event.target)) setInfoOpen(null); };
      const escape = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault(); event.stopPropagation();
        infoRoot.current?.querySelector('button')?.focus(); setInfoOpen(null);
      };
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('click', outside, true);
      document.addEventListener('keydown', escape, true);
      return () => {
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('click', outside, true);
        document.removeEventListener('keydown', escape, true);
      };
    }, [infoOpen?.id]);
    React.useEffect(() => {
      if (infoOpen && (!snapshot?.servers.some(({ config }) => config.id === infoOpen.id) || confirmation)) setInfoOpen(null);
    }, [snapshot, confirmation, infoOpen?.id]);
    React.useEffect(() => {
      if (!snapshot || automaticVault(snapshot.vault) || snapshot.vault.locked || !snapshot.vault.expiresAt) return;
      const timer = setTimeout(() => { clearInputs(); setSecretEditor(null); void refresh(); }, Math.max(0, snapshot.vault.expiresAt - Date.now()) + 25);
      return () => clearTimeout(timer);
    }, [snapshot?.vault.mode, snapshot?.vault.locked, snapshot?.vault.expiresAt, refresh, clearInputs]);
    async function run(method, fields = {}) {
      if (method === 'lock') { clearInputs(); setSecretEditor(null); if (mutation.current) { epoch.current++; return false; } }
      if ((!snapshot && method !== 'lock') || mutation.current) return false;
      // Advanced/manual controls never use the fresh-alias exception, even if a
      // stale enabled callback is invoked after another server becomes mounted.
      if (method === 'setSecret' || method === 'deleteSecret') {
        const latest = observedSnapshot.current;
        if (!alive.current || !latest || observedLoadFailed.current) return false;
        if (hasMountedServers(latest)) { setNotice({ error: true, text: t('errors.stop-before-secret-change') }); return false; }
      }
      const before = observedSnapshot.current ?? snapshot, previousRow = before?.servers.find(({ config }) => config.id === fields.id);
      mutation.current = true; const tick = ++epoch.current; setBusy(true); setNotice(null);
      const checksConnection = method === 'start' || method === 'reconnect';
      if (checksConnection) { setInfoOpen(null); setVerifying(fields.id); }
      let ok = false;
      try {
        const next = await api(method, { revision: snapshot?.revision ?? 0, ...fields });
        if (alive.current && tick === epoch.current) {
          observeSnapshot(next);
          if (method === 'start' || method === 'stop' || (method === 'reconnect' && persistentRow(before, previousRow))) {
            const row = next.servers.find(({ config }) => config.id === fields.id), wanted = method !== 'stop';
            const connected = row?.state === 'activation-verified' || row?.state === 'mounted-status-unavailable';
            if (!row || configKey(row.config) !== configKey(previousRow?.config) || (wanted ? !connected : activeState(row.state)) || integrationChecked(next, row) !== wanted || (persistentRow(before, previousRow) && !persistentRow(next, row))) throw { consoleCode: 'snapshot-contract-failed' };
          }
          if (checksConnection) setUncertain((previous) => Object.fromEntries(Object.entries(previous).filter(([serverId]) => serverId !== fields.id)));
          setNotice({ text: t('success') }); ok = true;
        }
      } catch (error) {
        if (alive.current && tick === epoch.current) {
          if (checksConnection) setUncertain((previous) => ({ ...previous, [fields.id]: snapshot.servers.find(({ config }) => config.id === fields.id)?.lastVerifiedAt }));
          setNotice({ error: true, text: errorText(error) });
        }
      }
      finally {
        mutation.current = false;
        if (alive.current) { setBusy(false); if (checksConnection) setVerifying(null); if (!ok || method === 'lock') void refresh(); }
      }
      return ok;
    }
    const button = (key, onClick, disabled = false, props = {}) => h(Button, { type: 'button', variant: 'outline', onClick, disabled: busy || disabled, ...props }, t(key));
    const field = (key, name, props = {}, hint, blockedHelp) => h('label', { className: 'mcp-field', key: name }, h('span', { className: 'mcp-field-label' }, t(key)), h(props.multiline ? 'textarea' : 'input', { id: id + '-' + name, name, ref: props.type === 'password' ? (name === 'passphrase' ? passphraseInput : name === 'token' ? tokenInput : secretInput) : undefined, autoComplete: 'off', autoCapitalize: 'none', spellCheck: false, ...props, multiline: undefined, 'aria-describedby': [hint && id + '-' + name + '-hint', blockedHelp && id + '-' + name + '-blocked'].filter(Boolean).join(' ') || undefined }), hint && h('span', { className: 'mcp-muted', id: id + '-' + name + '-hint' }, t(hint)), blockedHelp && h('span', { className: 'mcp-muted', id: id + '-' + name + '-blocked' }, t(blockedHelp)));
    const select = (key, name, value, onChange, options, disabled = false) => h('label', { className: 'mcp-field' }, h('span', { className: 'mcp-field-label' }, t(key)), h('select', { name, value, onChange: (event) => onChange(event.target.value), disabled: busy || disabled }, ...options.map(([value, key]) => h('option', { key: value, value }, t(key)))));
    const changeDraft = (name) => (event) => editDraft((draft) => ({ ...draft, [name]: event.target.value, ...(name === 'timeoutSeconds' ? { _timeoutEdited: true } : {}) }));
    const usedBy = (ref) => snapshot?.servers.filter(({ config }) => Object.values(config.envRefs ?? config.headerRefs ?? {}).includes(ref)).map(({ config }) => config.label) ?? [];
    const automatic = automaticVault(snapshot?.vault), outdatedHost = Boolean(snapshot && oldHostNeedsReload(snapshot.vault));
    const needsReload = Boolean(snapshot && !supportsValidatedSave(snapshot));
    const pendingSave = Boolean(editor?._pendingSave || editor?._pendingToken);
    const pendingMutation = () => !alive.current || mutation.current || busy || loadFailed || observedLoadFailed.current || pendingSave || editorRef.current?._pendingSave || editorRef.current?._pendingToken;
    function currentRow(row, revision, guard) {
      const latest = observedSnapshot.current, saved = latest?.servers.find(({ config }) => config.id === row.config.id);
      if (!latest || !saved || latest.revision !== revision || !sameActivationGuard(guard, latest, saved) || configKey(saved.config) !== configKey(row.config)) { setNotice({ error: true, text: t('conflict') }); return; }
      return { latest, saved };
    }
    async function toggleIntegration(row, revision, guard, checked) {
      if (pendingMutation() || typeof checked !== 'boolean') return;
      const current = currentRow(row, revision, guard); if (!current || checked === integrationChecked(current.latest, current.saved)) return;
      clearInputs(); editDraft(null); setSecretEditor(null); setConfirmation(null);
      await run(checked ? 'start' : 'stop', { revision: current.latest.revision, id: row.config.id, ...(checked ? { confirmation: 'START THIS SERVER' } : {}) });
    }
    async function reconnectServer(row, revision, guard) {
      if (pendingMutation()) return;
      const current = currentRow(row, revision, guard); if (!current) return;
      const method = recoveryMethod(current.latest, current.saved);
      if (!method || !schemas[method]) return;
      // Only the explicit native button click authorizes an unchanged RPC. With
      // saved OFF and a retained handle this icon retries STOP, never START.
      // Mounting, polling, refresh and information events remain read-only.
      setInfoOpen(null); clearInputs(); editDraft(null); setSecretEditor(null); setConfirmation(null); setAcknowledged(false);
      await run(method, { revision: current.latest.revision, id: row.config.id, ...(method === 'reconnect' ? { confirmation: 'RECONNECT THIS SERVER' } : {}) });
    }
    function openToolPolicy(row, revision, guard) {
      if (pendingMutation()) return;
      const current = currentRow(row, revision, guard); if (!current) return;
      if (!supportsToolPolicy(current.latest)) { setNotice({ error: true, text: t('policyUnavailable') }); return; }
      const policy = effectivePolicy(current.saved.config);
      editPolicy({ id: row.config.id, mode: policy.mode, names: [...policy.names], search: '', _revision: revision, _baseConfig: current.saved.config, _guard: guard, _verifiedAt: current.saved.lastVerifiedAt, _requiresRefresh: policyUncertain.current.has(row.config.id) || policyRecoveryNeeded(current.saved) });
    }
    async function applyToolPolicy(draft) {
      if (pendingMutation() || policyEditorRef.current !== draft || draft._requiresRefresh) return;
      const latest = observedSnapshot.current, row = latest?.servers.find(({ config }) => config.id === draft.id);
      if (!supportsToolPolicy(latest)) { setNotice({ error: true, text: t('policyUnavailable') }); return; }
      if (observedLoadFailed.current || !row || policyRecoveryNeeded(row) || latest.revision !== draft._revision || !sameActivationGuard(draft._guard, latest, row) || row.lastVerifiedAt !== draft._verifiedAt || configKey(row.config) !== configKey(draft._baseConfig)) {
        policyUncertain.current.add(draft.id); editPolicy({ ...draft, _requiresRefresh: true }); setNotice({ error: true, text: t('policyRefreshRequired') }); return;
      }
      let wanted;
      try { wanted = checkedPolicy({ mode: draft.mode, names: draft.mode === 'all' ? [] : draft.names }, draft.id); }
      catch (error) { setNotice({ error: true, text: errorText(error) }); return; }
      if (policyKey(wanted) === policyKey(effectivePolicy(row.config))) { editPolicy(null); setNotice({ text: t('success') }); return; }
      mutation.current = true; const tick = ++epoch.current; setBusy(true); setNotice(null);
      policyUncertain.current.add(draft.id);
      const attempted = { ...draft, _requiresRefresh: true, _attempted: true }; editPolicy(attempted);
      try {
        // Exact owner RPC only: no start/stop, credential, MCP or tool request.
        const next = await api('setToolPolicy', { revision: draft._revision, id: draft.id, toolPolicy: wanted });
        if (!alive.current || tick !== epoch.current || policyEditorRef.current !== attempted) return;
        const saved = next.servers.find(({ config }) => config.id === draft.id);
        observeSnapshot(next);
        if (!supportsToolPolicy(next) || !saved || policyRecoveryNeeded(saved) || next.revision !== draft._revision + 1 || policyKey(effectivePolicy(saved.config)) !== policyKey(wanted) || configKey({ ...saved.config, toolPolicy: undefined }) !== configKey({ ...draft._baseConfig, toolPolicy: undefined }) || !sameActivationGuard(draft._guard, next, saved) || saved.lastVerifiedAt !== draft._verifiedAt) throw { consoleCode: 'tool-policy-state-ambiguous' };
        policyUncertain.current.delete(draft.id); editPolicy(null); setNotice({ text: t('success') });
      } catch (error) {
        if (alive.current && tick === epoch.current) setNotice({ error: true, text: errorText(error) + ' ' + t('policyRefreshRequired') });
      } finally { mutation.current = false; if (alive.current) setBusy(false); }
    }
    async function recoverPolicyOff(row, revision, guard) {
      if (pendingMutation()) return;
      const current = currentRow(row, revision, guard); if (!current || !policyRecoveryNeeded(current.saved) || current.saved.lastFailure !== row.lastFailure) return;
      // Error-only explicit recovery, including an already-OFF unmounted row.
      // This is normal STOP, never a policy replay or reconnect/start fallback.
      clearInputs(); setSecretEditor(null); setConfirmation(null);
      await run('stop', { revision: current.latest.revision, id: row.config.id });
      if (policyEditorRef.current?.id === row.config.id) editPolicy({ ...policyEditorRef.current, _requiresRefresh: true });
    }
    function observedDraft(config, ledger) {
      return { ...createServerDraft(config, ledger.revision), _activationGuard: activationGuard(ledger, ledger.servers.find(({ config: saved }) => saved.id === config?.id)) };
    }
    function editServer(row, revision, guard) {
      if (pendingMutation()) return;
      const current = currentRow(row, revision, guard); if (!current) return;
      if (activeState(current.saved.state)) { setNotice({ error: true, text: t('targetEditBlocked') }); return; }
      clearInputs(); setConfirmation(null); setSecretEditor(null); editorFocusRequest.current++; editDraft(observedDraft(row.config, current.latest));
    }
    function cancelEditor() {
      const targetId = editorRef.current?.id;
      const summary = targetId ? root.current?.querySelector?.(`[data-server-id="${targetId}"] > details > summary`) : null;
      clearInputs(); editDraft(null);
      // The row summary survives cancelling the inline form; no extra tab stop.
      summary?.focus?.();
    }
    function removeServer(row, revision, guard) {
      if (pendingMutation()) return;
      const current = currentRow(row, revision, guard); if (!current) return;
      if (activeState(current.saved.state)) { setNotice({ error: true, text: t('errors.stop-before-delete') }); return; }
      clearInputs(); editDraft(null); setSecretEditor(null); setConfirmation({ kind: 'remove', config: row.config, revision, row, guard });
    }
    const mounted = hasMountedServers(snapshot);
    const targetMounted = (draft, ledger) => Boolean(draft?.id && ledger?.servers.some(({ config, state }) => config.id === draft.id && activeState(state)));
    const blockedFreshCredentials = (draft, ledger) => targetMounted(draft, ledger) || (hasMountedServers(ledger) && !supportsMountedSecretAppend(ledger));
    function assertInactiveTarget(draft, ledger) {
      const wantedPolicy = checkedPolicy(draft.toolPolicy?.mode === 'all' ? { mode: 'all', names: [] } : draft.toolPolicy ?? { mode: 'all', names: [] }, draft.id);
      if (!supportsToolPolicy(ledger) && policyKey(wantedPolicy) !== policyKey(effectivePolicy(draft._baseConfig))) throw { consoleCode: 'tool-policy-unavailable' };
      const originalTimeout = draft._baseConfig?.toolCallTimeoutMs ?? 60000;
      if (!supportsTimeout(ledger) && draft._timeoutEdited && Number(draft.timeoutSeconds) * 1000 !== originalTimeout) throw { consoleCode: 'timeout-unavailable' };
      if (targetMounted(draft, ledger)) throw { consoleCode: 'stop-before-edit' };
      const target = draft.id ? ledger.servers.find(({ config }) => config.id === draft.id) : undefined;
      if (draft._activationGuard && !sameActivationGuard(draft._activationGuard, ledger, target)) throw { consoleCode: 'revision-conflict' };
      if (draft.id && (!target || configKey(target.config) !== configKey(draft._baseConfig))) throw { consoleCode: 'revision-conflict' };
    }
    function assertFreshCredentialAccess(draft, ledger) {
      assertInactiveTarget(draft, ledger);
      if (hasMountedServers(ledger) && !supportsMountedSecretAppend(ledger)) throw { consoleCode: automaticVault(ledger.vault) ? 'append-secrets-upgrade-required' : 'stop-before-secret-change' };
    }
    function assertCurrentSecretStep(draft, ledger, ref) {
      const latest = observedSnapshot.current;
      if (!latest || observedLoadFailed.current || latest.revision !== draft._revision || ledger.revision !== draft._revision) throw { consoleCode: 'revision-conflict' };
      if (!supportsValidatedSave(latest) || !supportsValidatedSave(ledger)) throw { consoleCode: 'snapshot-contract-failed' };
      // Recheck both the returned ledger and the latest observed state immediately
      // before each write. Never reuse an alias, including on uncertain retries.
      for (const state of [ledger, latest]) {
        assertFreshCredentialAccess(draft, state);
        if (requiresVaultUnlock(state.vault)) throw { consoleCode: 'vault-locked' };
        if (ref && state.vault.refs.includes(ref)) throw { consoleCode: 'revision-conflict' };
      }
    }
    const closeSecretEditor = () => { clearInputs(); setSecretEditor(null); };
    function preflightBeforeVault(draft, event) {
      const token = tokenInput.current ?? event?.currentTarget?.elements?.token;
      const primary = Boolean(token?.value), rows = [], names = new Set(); let count = primary ? 1 : 0;
      if (primary && (!/^[\x21-\x7e]+$/.test(token.value) || /^Bearer(?:\s|$)/i.test(token.value) || token.value.length > 8185)) throw { consoleCode: 'invalid-input' };
      for (const row of draft.headerRows) {
        const input = headerInputs.current.get(row.id)?.current ?? event?.currentTarget?.elements?.['header-value-' + row.id], entered = Boolean(input?.value), key = row.name.toLowerCase();
        if (!row.savedRef && !entered) continue; // Blank NEW optional rows create no binding.
        if (names.has(key)) throw { consoleCode: 'invalid-headers' }; names.add(key);
        if (entered && (input.value.length > 8192 || /[\x00-\x1f\x7f-\x9f\u0100-\uffff]/.test(input.value))) throw { consoleCode: 'invalid-input' };
        if (primary && key === 'authorization' && entered) throw { consoleCode: 'authorization-ambiguous' };
        if (row.savedRef && row.savedName?.toLowerCase() !== key && !entered) throw { consoleCode: 'header-reentry-required' };
        if (entered || (primary && key === 'authorization')) {
          if (!validHeader(row.name) || protocolHeaders.has(key)) throw { consoleCode: 'invalid-headers' };
          if (entered) count++;
          // Nonpersistent, nonsecret placeholders validate metadata only.
          rows.push({ ...row, ref: 'pending_value', savedRef: 'pending_value', savedName: row.name, action: 'keep' });
        } else rows.push(row);
      }
      if (primary && !names.has('authorization')) rows.push({ name: 'Authorization', ref: 'pending_value', savedRef: 'pending_value', savedName: 'Authorization', action: 'keep' });
      serverFromDraft({ ...draft, headerRows: rows });
      const latest = observedSnapshot.current;
      if (!latest || observedLoadFailed.current) throw { consoleCode: 'revision-conflict' };
      if (!draft.id && latest.servers.length >= 32) throw { consoleCode: 'server-limit' };
      if (latest.vault.refs.length + count > 128) throw { consoleCode: 'secret-limit' };
      assertFreshCredentialAccess(draft, latest);
      if (draft._revision !== latest.revision) throw { consoleCode: 'revision-conflict' };
    }
    async function editorUnlock() {
      if (!supportsValidatedSave(snapshot)) { setNotice({ error: true, text: t('reloadSaveHost') }); return; }
      let draft = editorRef.current, passphrase = editorPassphraseInput.current?.value ?? '';
      if (editorPassphraseInput.current) editorPassphraseInput.current.value = '';
      if (!draft || draft.transport !== 'streamable-http' || !vaultPrompt || !snapshot || automatic || outdatedHost || needsReload || mutation.current || loadFailed) { passphrase = ''; return; }
      try {
        preflightBeforeVault(draft);
        if (!schemas.initializeVault.safeParse({ revision: draft._revision, passphrase }).success) throw { consoleCode: 'invalid-input' };
      } catch (error) { passphrase = ''; setNotice({ error: true, text: errorText(error) }); return; }
      const version = editorVersion.current, cleared = inputEpoch.current, initialRevision = snapshot.revision, ids = snapshot.servers.map(({config}) => config.id).sort().join(','), configured = configKey(snapshot.servers.map(({config}) => config).sort((a,b) => a.id.localeCompare(b.id)));
      mutation.current = true; const tick = ++epoch.current; setBusy(true); setNotice(null);
      const current = () => alive.current && tick === epoch.current && version === editorVersion.current && cleared === inputEpoch.current && editorRef.current === draft;
      const verify = (next, revision) => {
        assertInactiveTarget(draft, next);
        if (next.revision !== revision || next.servers.map(({config}) => config.id).sort().join(',') !== ids || next.servers.some(({state}) => activeState(state))) throw { consoleCode: 'revision-conflict' };
        if (automaticVault(next.vault) || configKey(next.servers.map(({config}) => config).sort((a,b) => a.id.localeCompare(b.id))) !== configured || (draft.id && configKey(next.servers.find(({config}) => config.id === draft.id)?.config) !== configKey(draft._baseConfig))) throw { consoleCode: 'revision-conflict' };
      };
      const adoptOwnRevision = (next) => { draft = { ...draft, _revision: next.revision }; editorRef.current = draft; setEditor(draft); observeSnapshot(next); };
      try {
        let ledger = await api('snapshot', {}); if (!current()) return;
        verify(ledger, initialRevision); observeSnapshot(ledger); if (!current()) return;
        if (!ledger.vault.initialized) {
          const next = await api('initializeVault', { revision: ledger.revision, passphrase }); if (!current()) return;
          verify(next, ledger.revision + 1); if (!next.vault.initialized || !next.vault.locked) throw { consoleCode: 'snapshot-contract-failed' };
          adoptOwnRevision(next); ledger = next; if (!current()) return;
        }
        const request = api('unlock', { revision: ledger.revision, passphrase, ttlSeconds: 300 }); passphrase = '';
        const next = await request; if (!current()) return;
        verify(next, ledger.revision + 1); if (!next.vault.initialized || next.vault.locked || next.vault.expiresAt <= Date.now()) throw { consoleCode: 'snapshot-contract-failed' };
        adoptOwnRevision(next); setVaultPrompt(false); setNotice({ text: t('editorVaultReady') });
      } catch (error) { if (current()) setNotice({ error: true, text: errorText(error) }); }
      finally { passphrase = ''; mutation.current = false; if (alive.current) { setBusy(false); void refresh(); } }
    }
    function editorVaultSetup() {
      if (automatic || outdatedHost || needsReload || !vaultPrompt || editor.transport !== 'streamable-http' || !requiresVaultUnlock(snapshot.vault)) return null;
      return h('details', { className: 'mcp-fields mcp-inline-vault mcp-disclosure', open: true, 'data-editor-vault': true }, h('summary', null, t('legacyVault')),
        h('h3', null, t('editorVaultTitle')), h('p', {className:'mcp-muted'}, t('editorVaultNote')),
        field('passphrase', 'editor-passphrase', { ref: editorPassphraseInput, type: 'password', minLength: 12, maxLength: 512, autoComplete: snapshot.vault.initialized ? 'current-password' : 'new-password', disabled: busy || loadFailed || mounted }),
        h('div', {className:'mcp-actions'}, button(snapshot.vault.initialized ? 'editorUnlock' : 'createAndUnlock', editorUnlock, loadFailed || mounted)));
    }
    const matchingSaveRows = (ledger, draft, server, originalIds) => ledger.servers.filter(({ config }) => (draft.id ? config.id === draft.id : !originalIds.includes(config.id)) && configKey(config) === configKey(server));
    const confirmedSaveActivation = (ledger, draft, row) => verifiedActivation(row, ledger) && (!draft._activationGuard || draft._activationGuard.capability === ledger.capabilities?.persistentActivation);
    function reconcilePendingActivation(draft, ledger, hasNewValues = false) {
      const pending = draft._pendingSave, wanted = serverFromDraft(draft);
      if (configKey(wanted) !== configKey(pending.expected)) throw { consoleCode: 'revision-conflict' };
      const matches = matchingSaveRows(ledger, draft, wanted, pending.originalIds);
      if (matches.length > 1) throw { consoleCode: 'revision-conflict' };
      if (matches.length) {
        if (hasNewValues) throw { consoleCode: 'revision-conflict' };
        observeSnapshot(ledger);
        if (confirmedSaveActivation(ledger, draft, matches[0])) { editDraft(null); setNotice({ text: t('success') }); return { terminal: true, ok: true }; }
        const next = { ...draft, id: matches[0].config.id, _baseConfig: matches[0].config, _revision: ledger.revision, _activationGuard: activationGuard(ledger, matches[0]), _pendingSave: { ...pending, reviewedInactive: true } };
        if (!pending.reviewedInactive || activeState(matches[0].state)) {
          editorRef.current = next; setEditor(next); setNotice({ error: true, text: t('activationUnconfirmed') });
          return { terminal: true, ok: false };
        }
        return { draft: next };
      }
      const target = draft.id ? ledger.servers.find(({ config }) => config.id === draft.id) : undefined;
      if ((draft.id && (!target || configKey(target.config) !== configKey(draft._baseConfig))) || (!draft.id && ledger.servers.some(({ config }) => !pending.originalIds.includes(config.id)))) throw { consoleCode: 'revision-conflict' };
      return { draft: { ...draft, _revision: ledger.revision } };
    }
    function releaseConfirmedValidationFailure(draft, error) {
      // This explicit backend failure guarantees no configuration was committed.
      // Transport, storage, cleanup, and ambiguous errors retain reconciliation.
      if (!provenConnectionFailures.has(ownData(error, 'consoleCode')) || !draft._pendingSave) return draft;
      const { _pendingSave, ...retry } = draft;
      const activeRefs = new Set(Object.values(_pendingSave.expected.headerRefs ?? {}));
      if (retry._pendingToken?.stage === 'metadata' && retry._pendingToken.writes.filter(({ ref }) => activeRefs.has(ref)).every(({ status }) => status === 'saved')) delete retry._pendingToken;
      return retry; // Keep nonsecret config, latest revision, and savedRef bindings.
    }
    async function saveWithoutNewSecrets(draft) {
      const version = editorVersion.current, cleared = inputEpoch.current;
      mutation.current = true; const tick = ++epoch.current; setBusy(true); setNotice(null);
      const current = () => alive.current && tick === epoch.current && version === editorVersion.current && cleared === inputEpoch.current;
      let attempted = false, ok = false, ledger = observedSnapshot.current;
      const progress = (next) => { draft = next; editorRef.current = next; setEditor(next); };
      try {
        if (draft._pendingSave) {
          ledger = await api('snapshot', {}); if (!current()) return;
          if (!supportsValidatedSave(ledger)) { observeSnapshot(ledger); setNotice({ error: true, text: t('reloadSaveHost') }); return; }
          const reconciled = reconcilePendingActivation(draft, ledger);
          if (reconciled.terminal) { ok = reconciled.ok; return; }
          progress(reconciled.draft); observeSnapshot(ledger);
        }
        if (!current() || !ledger || observedLoadFailed.current) return;
        assertInactiveTarget(draft, ledger);
        const server = serverFromDraft(draft), originalIds = draft._pendingSave?.originalIds ?? ledger.servers.map(({ config }) => config.id);
        progress({ ...draft, _pendingSave: { expected: server, originalIds, reviewedInactive: false } });
        attempted = true;
        const next = await api('saveAndActivate', { revision: draft._revision, server, confirmation: 'SAVE AND ACTIVATE THIS SERVER' });
        if (!current()) return;
        const saved = matchingSaveRows(next, draft, server, originalIds);
        observeSnapshot(next);
        if (saved.length !== 1 || !confirmedSaveActivation(next, draft, saved[0])) throw { consoleCode: 'snapshot-contract-failed' };
        editDraft(null); setNotice({ text: t('success') }); ok = true;
      } catch (error) {
        if (current()) { progress(releaseConfirmedValidationFailure(draft, error)); setNotice({ error: true, text: (draft._pendingSave ? t('savePending') + ' ' : '') + errorText(error) }); }
      }
      finally { mutation.current = false; if (alive.current) { setBusy(false); if (!ok && attempted) void refresh(); } }
    }
    async function save(event) {
      event.preventDefault();
      let draft = editorRef.current;
      const latest = observedSnapshot.current;
      if (!alive.current || !draft || mutation.current || !latest || !snapshot || loadFailed || observedLoadFailed.current) return;
      // Capability gate uses live observation, not a stale render's callback.
      // Old hosts retain typed masked values; metadata-only save is never a fallback.
      if (!supportsValidatedSave(latest)) { setNotice({ error: true, text: t('reloadSaveHost') }); return; }
      const locked = requiresVaultUnlock(latest.vault);
      const entered = Boolean((tokenInput.current ?? event.currentTarget?.elements?.token)?.value) || draft.headerRows.some((row) => Boolean((headerInputs.current.get(row.id)?.current ?? event.currentTarget?.elements?.['header-value-' + row.id])?.value));
      if (draft.transport === 'streamable-http' && oldHostNeedsReload(latest.vault) && (entered || draft._pendingToken)) { setNotice({ error: true, text: t('reloadAutomaticHost') }); return; }
      if (!draft._pendingSave && !draft._pendingToken) {
        try {
          assertInactiveTarget(draft, latest);
          if (draft.transport === 'streamable-http' && entered) assertFreshCredentialAccess(draft, latest);
        } catch (error) { setNotice({ error: true, text: errorText(error) }); return; }
      }
      if (draft.transport === 'streamable-http' && locked && (entered || draft._pendingToken)) {
        try { preflightBeforeVault(draft, event); setVaultPrompt(true); setNotice({ text: t('editorVaultNote') }); }
        catch (error) { setNotice({ error: true, text: errorText(error) }); }
        return; // NO value collection, DOM clearing, secret RPC or metadata write.
      }
      const captured = [];
      const read = (kind, rowId, input) => { captured.push({ kind, rowId, value: input?.value ?? '' }); if (input) input.value = ''; };
      read('token', null, tokenInput.current ?? event.currentTarget?.elements?.token);
      for (const row of draft?.headerRows ?? []) read('header', row.id, headerInputs.current.get(row.id)?.current ?? event.currentTarget?.elements?.['header-value-' + row.id]);
      clearInputs();
      const wipe = () => { for (const item of captured) item.value = ''; };
      const version = editorVersion.current;
      if (!draft || mutation.current || !snapshot || loadFailed) { wipe(); return; }
      if (draft.transport !== 'streamable-http') {
        wipe(); try { serverFromDraft(draft); } catch (error) { setNotice({ error: true, text: errorText(error) }); return; }
        await saveWithoutNewSecrets(draft);
        return;
      }
      draft = { ...draft, headerRows: draft.headerRows.filter((row) => row.savedRef || captured.some((item) => item.kind === 'header' && item.rowId === row.id && item.value)) };
      const token = captured[0], values = captured.filter((item) => item.value);
      try {
        if (token.value && (!/^[\x21-\x7e]+$/.test(token.value) || /^Bearer(?:\s|$)/i.test(token.value))) throw { consoleCode: 'invalid-input' };
        for (const item of values) if (item.kind === 'header' && (item.value.length > 8192 || /[\x00-\x1f\x7f-\x9f\u0100-\uffff]/.test(item.value))) throw { consoleCode: 'invalid-input' };
        if (token.value && values.some((item) => item.kind === 'header' && draft.headerRows.find((row) => row.id === item.rowId)?.name.toLowerCase() === 'authorization')) throw { consoleCode: 'authorization-ambiguous' };
        for (const row of draft.headerRows) if (row.savedRef && row.savedName?.toLowerCase() !== row.name.toLowerCase() && !values.some((item) => item.rowId === row.id)) throw { consoleCode: 'header-reentry-required' };
        if (!values.length && !draft._pendingToken) {
          const server = serverFromDraft(draft);
          await saveWithoutNewSecrets(draft);
          return;
        }
      } catch (error) { wipe(); setNotice({ error: true, text: errorText(error) }); return; }
      mutation.current = true; const tick = ++epoch.current, cleared = inputEpoch.current;
      const current = () => alive.current && tick === epoch.current && version === editorVersion.current && cleared === inputEpoch.current;
      const progress = (next) => { draft = next; editorRef.current = next; setEditor(next); };
      const accept = observeSnapshot;
      let ledger = latest, ok = false, attempted = false;
      setBusy(true); setNotice(null);
      try {
        if (draft._pendingToken || draft._pendingSave) {
          ledger = await api('snapshot', {});
          if (!current()) return;
          if (!supportsValidatedSave(ledger)) { accept(ledger); setNotice({ error: true, text: t('reloadSaveHost') }); return; }
          if (draft._pendingSave) {
            const reconciled = reconcilePendingActivation(draft, ledger, Boolean(values.length));
            if (reconciled.terminal) { ok = reconciled.ok; return; }
            progress(reconciled.draft);
          }
          if (draft._pendingToken) {
          const history = draft._pendingToken.writes;
          const committed = ledger.servers.filter(({ config }) => history.some(({ ref }) => Object.values(config.headerRefs ?? {}).includes(ref)));
          if (committed.length) {
            const wanted = serverFromDraft(draft);
            if (values.length || committed.length !== 1 || configKey(committed[0].config) !== configKey(wanted)) throw { consoleCode: 'revision-conflict' };
            accept(ledger);
            if (confirmedSaveActivation(ledger, draft, committed[0])) { editDraft(null); setNotice({ text: t('success') }); ok = true; return; }
            if (!draft._pendingSave?.reviewedInactive || activeState(committed[0].state)) { setNotice({ error: true, text: t('activationUnconfirmed') }); return; }
          }
          const target = draft.id ? ledger.servers.find(({ config }) => config.id === draft.id) : undefined;
          if (draft.id && (!target || configKey(target.config) !== configKey(draft._baseConfig))) throw { consoleCode: 'revision-conflict' };
          if (!draft.id && draft._pendingToken.metadataAttempted && (!history.some(({ ref }) => Object.values(serverFromDraft(draft).headerRefs).includes(ref)) || ledger.servers.some(({ config }) => !draft._pendingToken.originalIds.includes(config.id)))) throw { consoleCode: 'revision-conflict' };
          const writes = history.map((item) => ({ ...item, status: ledger.vault.refs.includes(item.ref) ? 'saved' : 'missing' }));
          progress({ ...draft, _revision: ledger.revision, _pendingToken: { ...draft._pendingToken, writes, known: writes.some((item) => item.status === 'saved'), stage: writes.some((item) => item.status === 'missing') ? 'missing' : 'metadata' } });
          }
        }
        accept(ledger); if (!current()) return;
        assertFreshCredentialAccess(draft, ledger);
        if (requiresVaultUnlock(ledger.vault)) throw { consoleCode: 'vault-locked' };
        if (!draft.id && ledger.servers.length >= 32) throw { consoleCode: 'server-limit' };
        if (!draft._pendingToken && draft._revision !== ledger.revision) throw { consoleCode: 'revision-conflict' };
        const names = new Set();
        for (const row of draft.headerRows) { const key = row.name.toLowerCase(); if (names.has(key)) throw { consoleCode: 'invalid-headers' }; names.add(key); }
        const excluded = [...ledger.vault.refs, ...(draft._pendingToken?.writes ?? []).map((item) => item.ref)];
        const queue = [], previous = draft._pendingToken;
        let rows = draft.headerRows.map((row) => ({ ...row }));
        for (const item of values) {
          let row = item.kind === 'token' ? rows.find((row) => row.name.toLowerCase() === 'authorization') : rows.find((row) => row.id === item.rowId);
          if (!row) { if (item.kind !== 'token') throw { consoleCode: 'invalid-input' }; row = { id: headerId(), name: 'Authorization', custom: false }; rows.push(row); }
          if (!validHeader(row.name) || protocolHeaders.has(row.name.toLowerCase())) throw { consoleCode: 'invalid-headers' };
          const ref = freshTokenRef(excluded); excluded.push(ref);
          const replacement = { ...row, ref, savedRef: ref, savedName: row.name, action: 'keep' };
          rows = rows.map((candidate) => candidate.id === row.id ? replacement : candidate);
          if (item.kind === 'token') item.value = 'Bearer ' + item.value;
          if (!schemas.setSecret.safeParse({ revision: draft._revision, ref, value: item.value }).success) throw { consoleCode: 'invalid-input' };
          queue.push({ item, write: { ref, rowId: row.id, kind: item.kind, header: row.name, status: 'pending' } });
        }
        const candidate = { ...draft, headerRows: rows }, server = serverFromDraft(candidate);
        if (ledger.vault.refs.length + queue.length > 128) throw { consoleCode: 'secret-limit' };
        const writes = [...(previous?.writes ?? []), ...queue.map(({ write }) => write)];
        const active = new Set(Object.values(server.headerRefs));
        const missing = writes.filter((write) => active.has(write.ref) && write.status === 'missing' && !queue.some(({ write: fresh }) => fresh.ref === write.ref));
        const pending = { writes, ref: writes[0]?.ref, known: writes.some((item) => item.status === 'saved'), stage: missing.length ? 'missing' : 'writing', expected: server, metadataAttempted: previous?.metadataAttempted ?? false, originalIds: previous?.originalIds ?? ledger.servers.map(({ config }) => config.id) };
        progress({ ...candidate, _pendingToken: pending });
        if (missing.length) { accept(ledger); setNotice({ error: true, text: t('tokenMissing') }); return; }
        // ALL metadata, values, counts and collisions are validated before the
        // FIRST write. Remaining values live only in this local in-flight queue.
        for (const { item, write } of queue) {
          if (!current()) return;
          assertCurrentSecretStep(draft, ledger, write.ref);
          const previousRevision = ledger.revision;
          progress({ ...draft, _pendingToken: { ...draft._pendingToken, writes: draft._pendingToken.writes.map((entry) => entry.ref === write.ref ? { ...entry, status: 'unknown' } : entry) } });
          attempted = true;
          const request = api('setSecret', { revision: draft._revision, ref: write.ref, value: item.value });
          item.value = ''; // Handoff clears each local plaintext before await.
          const next = await request;
          if (!current()) return;
          if (!next.vault.refs.includes(write.ref)) throw { consoleCode: 'snapshot-contract-failed' };
          progress({ ...draft, _revision: next.revision, _pendingToken: { ...draft._pendingToken, known: true, writes: draft._pendingToken.writes.map((entry) => entry.ref === write.ref ? { ...entry, status: 'saved' } : entry) } });
          accept(next); ledger = next;
          if (!current()) return;
          if (next.revision !== previousRevision + 1) throw { consoleCode: 'revision-conflict' };
          if (!supportsValidatedSave(next)) { setNotice({ error: true, text: t('reloadSaveHost') }); return; }
          assertFreshCredentialAccess(draft, next);
        }
        if (!current()) return;
        assertCurrentSecretStep(draft, ledger);
        progress({ ...draft, _pendingToken: { ...draft._pendingToken, stage: 'metadata', metadataAttempted: true }, _pendingSave: { expected: server, originalIds: draft._pendingToken.originalIds, reviewedInactive: false } });
        attempted = true;
        const next = await api('saveAndActivate', { revision: draft._revision, server, confirmation: 'SAVE AND ACTIVATE THIS SERVER' });
        if (!current()) return;
        const saved = matchingSaveRows(next, draft, server, draft._pendingToken.originalIds);
        accept(next);
        if (saved.length !== 1 || !confirmedSaveActivation(next, draft, saved[0])) throw { consoleCode: 'snapshot-contract-failed' };
        editDraft(null); setNotice({ text: t('success') }); ok = true;
      } catch (error) {
        if (current()) { progress(releaseConfirmedValidationFailure(draft, error)); setNotice({ error: true, text: (draft._pendingToken ? t(draft._pendingToken.known ? 'tokenPending' : 'tokenUncertain') + ' ' : '') + errorText(error) }); }
      } finally {
        wipe(); mutation.current = false;
        if (alive.current) { setBusy(false); if (!ok && attempted) void refresh(); }
      }
    }
    async function passphraseSubmit(event) {
      event.preventDefault();
      if (!supportsValidatedSave(snapshot)) { setNotice({ error: true, text: t('reloadSaveHost') }); return; }
      const input = event.currentTarget.elements.passphrase; const passphrase = input.value; input.value = '';
      await run(snapshot.vault.initialized ? 'unlock' : 'initializeVault', { passphrase, ...(snapshot.vault.initialized ? { ttlSeconds: 300 } : {}) });
    }
    async function secretSubmit(event) {
      event.preventDefault();
      if (!secretEditor || mutation.current || !alive.current) return;
      if (secretEditor.action === 'keep') { closeSecretEditor(); setNotice({ text: t('kept') }); return; }
      const latest = observedSnapshot.current;
      if (!latest || observedLoadFailed.current) return;
      if (!supportsValidatedSave(latest)) { setNotice({ error: true, text: t('reloadSaveHost') }); return; }
      if (hasMountedServers(latest)) { setNotice({ error: true, text: t('errors.stop-before-secret-change') }); return; }
      if (secretEditor._revision !== latest.revision) { setNotice({ error: true, text: t('conflict') }); return; }
      if (secretEditor.action === 'clear') {
        clearInputs(); setConfirmation({ kind: 'secret', ref: secretEditor.ref, revision: secretEditor._revision }); return;
      }
      const input = event.currentTarget.elements.secret; let value = input.value; input.value = '';
      if (!secretEditor.existing && snapshot.vault.refs.includes(secretEditor.ref)) { setNotice({ error: true, text: t('errors.invalid-input') }); return; }
      if (secretEditor.format === 'bearer') {
        // Never silently trim or accept a double prefix. No value enters React state.
        if (!/^[\x21-\x7e]+$/.test(value) || /^Bearer\s/i.test(value)) { setNotice({ error: true, text: t('errors.invalid-input') }); return; }
        value = 'Bearer ' + value;
      }
      if (await run('setSecret', { revision: secretEditor._revision, ref: secretEditor.ref, value }) && alive.current) setSecretEditor(null);
    }
    async function confirm() {
      const connects = confirmation?.kind === 'start';
      if (!confirmation || !snapshot || busy || loadFailed || (connects && !acknowledged)) return;
      if (confirmation.kind === 'secret') {
        const latest = observedSnapshot.current;
        if (!latest || observedLoadFailed.current) return;
        if (!supportsValidatedSave(latest)) { setNotice({ error: true, text: t('reloadSaveHost') }); return; }
        if (hasMountedServers(latest)) { setNotice({ error: true, text: t('errors.stop-before-secret-change') }); return; }
        if (confirmation.revision !== latest.revision) { setNotice({ error: true, text: t('conflict') }); setConfirmation(null); return; }
      }
      if (confirmation.kind === 'remove') {
        const current = currentRow(confirmation.row, confirmation.revision, confirmation.guard);
        if (!current) { setConfirmation(null); return; }
        if (activeState(current.saved.state)) { setNotice({ error: true, text: t('errors.stop-before-delete') }); setConfirmation(null); return; }
      }
      if (confirmation.revision !== snapshot.revision) { setNotice({ error: true, text: t('conflict') }); setConfirmation(null); return; }
      const method = confirmation.kind === 'start' ? 'start' : confirmation.kind === 'secret' ? 'deleteSecret' : 'deleteServer';
      const fields = confirmation.kind === 'secret' ? { ref: confirmation.ref } : { id: confirmation.config.id, ...(connects ? { confirmation: 'START THIS SERVER' } : {}) };
      if (await run(method, fields) && alive.current) { setConfirmation(null); if (method === 'deleteSecret') setSecretEditor(null); }
    }
    function tokenField() {
      const locked = requiresVaultUnlock(snapshot.vault), pending = editor._pendingToken, ownMounted = targetMounted(editor, snapshot), blocked = blockedFreshCredentials(editor, snapshot);
      return h(React.Fragment, null,
        field('token', 'token', { type: 'password', maxLength: 8185, autoComplete: 'new-password', disabled: busy || loadFailed || blocked || Boolean(pending && pending.stage !== 'missing') }, 'tokenNote', ownMounted ? 'targetEditBlocked' : undefined),
        editor.headerRows.some((row) => row.savedRef && snapshot.vault.refs.includes(row.savedRef) && row.name.toLowerCase() === 'authorization') && h('p', { className: 'mcp-muted' }, t('savedAuthentication')),
        !ownMounted && (locked || mounted) && h('p', { className: 'mcp-muted' }, t(mounted ? supportsMountedSecretAppend(snapshot) ? 'appendSecretsNote' : automatic ? 'reloadMountedSecretsHost' : 'tokenMounted' : outdatedHost ? 'reloadAutomaticHost' : 'tokenLocked')),
        pending && !busy && h('p', { className: 'mcp-error' }, t(pending.stage === 'missing' ? 'tokenMissing' : pending.known ? 'tokenPending' : 'tokenUncertain')));
    }
    function editorMappings() {
      if (editor.transport === 'stdio') {
        const rows = editor.envRows;
        const update = (index, patch) => editDraft((draft) => ({ ...draft, envRows: draft.envRows.map((row, i) => i === index ? { ...row, ...patch } : row) }));
        return h('fieldset', { className: 'mcp-fields' }, h('legend', null, t('refsTitle')), h('p', { className: 'mcp-muted' }, t('refsNote')), !rows.length && h('p', { className: 'mcp-muted' }, t('noRefs')),
          ...rows.map((row, index) => h('div', { className: 'mcp-mapping', key: index },
            field('envName', 'mapping-name-' + index, { value: row.name, onChange: (event) => update(index, { name: event.target.value }), required: row.action !== 'clear', maxLength: 64, disabled: row.action === 'clear' }),
            select('mappingAction', 'mapping-action-' + index, row.action, (action) => update(index, { action }), [...(row.savedRef ? [['keep', 'keep']] : []), ['replace', 'replace'], ['clear', 'clear']]),
            row.action === 'clear' ? h('p', { className: 'mcp-muted mcp-wide' }, t('clearRef')) : field('reference', 'mapping-ref-' + index, { value: row.action === 'keep' ? row.savedRef : row.ref, onChange: (event) => update(index, { ref: event.target.value }), readOnly: row.action === 'keep', required: true, maxLength: 64, pattern: '[A-Za-z][A-Za-z0-9_-]{0,63}', list: id + '-vault-refs', className: 'mcp-wide' }, row.action === 'keep' ? 'keepRef' : undefined))),
          h('datalist', { id: id + '-vault-refs' }, ...snapshot.vault.refs.map((ref) => h('option', { key: ref, value: ref }))),
          h('div', { className: 'mcp-actions' }, button('addRef', () => editDraft((draft) => ({ ...draft, envRows: [...draft.envRows, { name: '', ref: '', action: 'replace', custom: false }] })), rows.length >= 32)));
      }
      const rows = editor.headerRows, pending = editor._pendingToken, ownMounted = targetMounted(editor, snapshot), blocked = blockedFreshCredentials(editor, snapshot);
      const update = (rowId, patch) => { const previous = editorRef.current.headerRows.find((row) => row.id === rowId); if (patch.name !== undefined && patch.name !== previous?.name) { const input = headerInputs.current.get(rowId)?.current; if (input) input.value = ''; inputEpoch.current++; } editDraft((draft) => ({ ...draft, headerRows: draft.headerRows.map((row) => row.id === rowId ? { ...row, ...patch } : row) })); };
      const iconButton = (key, onClick, trash, disabled = false) => h(Button, { type: 'button', variant: 'outline', className: trash ? 'mcp-header-action mcp-header-trash' : 'mcp-header-action', onClick, disabled: busy || disabled, 'aria-label': t(key), title: t(key), 'data-danger': trash || undefined },
        h('svg', { width: trash ? 16 : 20, height: trash ? 16 : 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true, focusable: 'false', 'data-header-icon': trash ? 'trash' : 'plus' }, h('path', { d: trash ? 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7' : 'M12 5v14M5 12h14', strokeLinecap: 'round', strokeLinejoin: 'round' })), !trash && t(key));
      return h('fieldset', { className: 'mcp-fields mcp-http-headers' }, h('legend', null, t('headers')),
        ...rows.map((row, index) => {
          if (!headerInputs.current.has(row.id)) headerInputs.current.set(row.id, { current: null });
          const ref = headerInputs.current.get(row.id);
          const remove = () => { if (ref.current) ref.current.value = ''; headerInputs.current.delete(row.id); inputEpoch.current++; editDraft((draft) => ({ ...draft, headerRows: draft.headerRows.filter((candidate) => candidate.id !== row.id) })); };
          return h('div', { className: 'mcp-http-header', key: row.id, 'data-header-id': row.id },
            h('div', { className: 'mcp-fields mcp-header-name' }, h('div', { className: 'mcp-header-caption' }, h('label', { htmlFor: id + '-header-select-' + row.id, className: 'mcp-field-label' }, t('headerName')), iconButton('removeHeader', remove, true)), h('select', { id: id + '-header-select-' + row.id, name: 'mapping-header-' + index, value: row.custom ? 'custom' : row.name, disabled: busy, onChange: (event) => update(row.id, { name: event.target.value === 'custom' ? row.name : event.target.value, custom: event.target.value === 'custom' }) }, ...[['', 'selectHeader'], ...commonHeaders.map((name) => [name, name]), ['custom', 'customHeader']].map(([value, key]) => h('option', { key: value, value }, t(key)))), row.custom && field('headerName', 'mapping-name-' + index, { value: row.name, onChange: (event) => update(row.id, { name: event.target.value }), maxLength: 64 }), row.savedRef && row.savedName?.toLowerCase() !== row.name.toLowerCase() && h('p', { className: 'mcp-muted' }, t('headerRenameNote'))),
            field('headerValue', 'header-value-' + row.id, { ref, type: 'password', maxLength: 8192, autoComplete: 'new-password', className: 'mcp-header-secret', disabled: busy || loadFailed || blocked || Boolean(pending && pending.stage !== 'missing') }, row.savedRef && snapshot.vault.refs.includes(row.savedRef) ? 'savedHeaderValue' : 'headerValueNote', ownMounted ? 'targetEditBlocked' : undefined)); 
        }),
        h('div', { className: 'mcp-actions' }, iconButton('addHeader', () => editDraft((draft) => ({ ...draft, headerRows: [...draft.headerRows, { id: headerId(), name: '', ref: '', action: 'replace', custom: false }] })), false, rows.length >= 32)));
    }
    function advancedSecretControls() {
      // Shared write-only controls; automatic stdio needs no initialization or password.
      return h('details', { className: 'mcp-disclosure', 'data-automatic-secrets': automatic || undefined }, h('summary', null, t('advancedVault')),
            h('div', { className: 'mcp-actions' }, button('addSecret', () => { clearInputs(); editDraft(null); setConfirmation(null); setSecretEditor({ ref: '', action: 'replace', format: 'raw', _revision: snapshot.revision }); }, mounted || loadFailed || snapshot.vault.refs.length >= 128), !automatic && button('lock', () => run('lock'))),
            !snapshot.vault.refs.length && h('p', { className: 'mcp-muted' }, t('noSecrets')),
            h('ul', { className: 'mcp-rows' }, ...snapshot.vault.refs.map((ref) => h('li', { key: ref }, h('div', { className: 'mcp-head' }, h('code', null, ref), button('editSecret', () => { clearInputs(); editDraft(null); setConfirmation(null); setSecretEditor({ ref, existing: true, action: 'keep', format: 'raw', _revision: snapshot.revision }); }, mounted || loadFailed)), h('p', { className: 'mcp-muted' }, usedBy(ref).length ? t('referencedBy') + ': ' + usedBy(ref).join(', ') : t('unused')))),
            secretEditor && h('form', { key: secretEditor.existing ? secretEditor.ref : 'new-secret', className: 'mcp-fields', onSubmit: secretSubmit, 'aria-label': t(secretEditor.existing ? 'editSecret' : 'addSecret') }, h('fieldset', { className: 'mcp-fields', disabled: busy || mounted || loadFailed },
              field('secretRef', 'ref', { value: secretEditor.ref, onChange: (event) => setSecretEditor((draft) => ({ ...draft, ref: event.target.value })), readOnly: secretEditor.existing, required: true, maxLength: 64, pattern: '[A-Za-z][A-Za-z0-9_-]{0,63}' }),
              select('secretAction', 'secretAction', secretEditor.action, (action) => { clearInputs(); setSecretEditor((draft) => ({ ...draft, action })); }, [...(secretEditor.existing ? [['keep', 'keep']] : []), ['replace', 'replace'], ...(secretEditor.existing ? [['clear', 'clear']] : [])]),
              h('p', { className: 'mcp-muted' }, t(secretEditor.action === 'keep' ? 'keepSecret' : secretEditor.action === 'clear' ? 'clearSecret' : 'replaceSecret')),
              secretEditor.action === 'replace' && h(React.Fragment, null, select('secretFormat', 'secretFormat', secretEditor.format, (format) => { clearInputs(); setSecretEditor((draft) => ({ ...draft, format })); }, [['raw', 'raw'], ['bearer', 'bearer']]), field('secretValue', 'secret', { type: 'password', required: true, maxLength: secretEditor.format === 'bearer' ? 8185 : 8192, autoComplete: 'new-password' })),
              secretEditor.action === 'clear' && usedBy(secretEditor.ref).length > 0 && h('p', { className: 'mcp-error' }, t('inUse')),
              h('div', { className: 'mcp-actions' }, h(Button, { type: 'submit', disabled: busy || mounted || loadFailed || (secretEditor.action === 'clear' && usedBy(secretEditor.ref).length > 0) }, t('saveSecret')), button('cancel', closeSecretEditor))))));
    }
    function policyChoices(mode, names, update, row, prefix, search = '', blocked = false) {
      // Inventory is local mount/last-known metadata only. Render exact public
      // names as React text; never request/render remote descriptions or schema.
      const inventory = (['mounted', 'last-known'].includes(row?.tools?.source) ? row.tools.names : []).slice(0, 512).filter((name) => {
        try { checkedPolicy({ mode: 'include', names: [name] }, row?.config.id); return true; } catch { return false; }
      });
      const listed = [...new Set([...inventory, ...names])].sort();
      const source = row?.tools?.source ?? 'unavailable';
      return h('div', { className: 'mcp-fields mcp-tool-policy' },
        select('policyMode', prefix + '-mode', mode, (value) => update({ mode: value }), [['all', 'policyAll'], ['include', 'policyInclude'], ['exclude', 'policyExclude']], blocked),
        h('p', { className: 'mcp-muted' }, t(mode === 'include' ? 'policyIncludeNote' : mode === 'exclude' ? 'policyExcludeNote' : 'policyAllNote')),
        h('p', { className: 'mcp-muted' }, t('policyNamesNote')),
        mode !== 'all' && h(React.Fragment, null,
          field('policySearch', prefix + '-search', { type: 'search', value: search, maxLength: 128, onChange: (event) => update({ search: event.target.value }), disabled: busy || blocked }),
          h('p', { className: 'mcp-muted' }, t(source === 'mounted' ? 'policyInventoryMounted' : source === 'last-known' ? 'policyInventoryKnown' : 'policyInventoryUnavailable')),
          !row && h('p', { className: 'mcp-muted' }, t('policyNewServer')),
          h('ul', { className: 'mcp-rows mcp-tool-names', 'aria-label': t('policyNames') }, ...listed.filter((name) => name.toLowerCase().includes(search.toLowerCase())).map((name) => h('li', { key: name },
            h(Checkbox, { className: 'mcp-tool-choice', title: name.replace(/^mcp__pc_[a-f0-9]{24}__/, ''), label: name.replace(/^mcp__pc_[a-f0-9]{24}__/, ''), checked: names.includes(name), disabled: busy || blocked || (!names.includes(name) && names.length >= 512), onChange: (checked) => {
              if (busy || blocked || typeof checked !== 'boolean') return;
              const selected = checked ? [...new Set([...names, name])] : names.filter((entry) => entry !== name);
              if (selected.length <= 512) update({ names: selected });
            } }), !inventory.includes(name) && h('span', { className: 'mcp-muted' }, t('policyMissingName'))))),
          h('p', { className: 'mcp-muted' }, names.length + ' / 512 · ' + t('policySelectionLimit'))));
    }
    function serverPolicy(row) {
      const draft = policyEditor?.id === row.config.id ? policyEditor : null;
      const supported = supportsToolPolicy(snapshot), policy = effectivePolicy(row.config);
      return h('details', { className: 'mcp-disclosure', 'data-tool-policy': row.config.id }, h('summary', null, t('toolPolicy')),
        h('p', { className: 'mcp-muted' }, t('policyLocalNote')),
        !supported && h('p', { className: 'mcp-muted' }, t('policyUnavailable')),
        policyRecoveryNeeded(row) && h('div', { className: 'mcp-fields', 'data-policy-recovery': row.config.id },
          h('p', { className: 'mcp-error' }, t('policyRecoverOffNote')),
          h('div', { className: 'mcp-actions' }, button('policyRecoverOff', () => recoverPolicyOff(row, snapshot.revision, activationGuard(snapshot, row)), loadFailed || pendingSave))),
        draft ? h('div', { className: 'mcp-fields', 'data-policy-manager': row.config.id },
          policyChoices(draft.mode, draft.names, (patch) => { if (policyEditorRef.current !== draft || mutation.current) return; editPolicy({ ...draft, ...patch }); }, row, 'policy-' + row.config.id, draft.search, !supported || loadFailed),
          draft._requiresRefresh && h('p', { className: 'mcp-error', role: 'alert' }, t('policyRefreshRequired')),
          h('div', { className: 'mcp-actions' }, button('policyApply', () => applyToolPolicy(draft), !supported || loadFailed || pendingSave || draft._requiresRefresh || policyRecoveryNeeded(row)), button('cancel', () => editPolicy(null)))) : h(React.Fragment, null,
          h('p', { className: 'mcp-muted' }, t(policy.mode === 'all' ? 'policyAll' : policy.mode === 'include' ? 'policyInclude' : 'policyExclude') + (policy.mode === 'all' ? '' : ' · ' + policy.names.length)),
          h('div', { className: 'mcp-actions' }, button('policyManage', () => openToolPolicy(row, snapshot.revision, activationGuard(snapshot, row)), !supported || loadFailed || pendingSave))));
    }
    function editorAdvanced() {
      const row = snapshot.servers.find(({ config }) => config.id === editor.id);
      return h('details', { className: 'mcp-disclosure', 'data-advanced-server': true }, h('summary', null, t('advancedServer')),
        h('div', { className: 'mcp-fields' },
          supportsToolPolicy(snapshot) ? h('fieldset', { className: 'mcp-fields' }, h('legend', null, t('toolPolicy')), policyChoices(editor.toolPolicy.mode, editor.toolPolicy.names, (patch) => editDraft((draft) => ({ ...draft, toolPolicy: { ...draft.toolPolicy, ...(patch.mode ? { mode: patch.mode } : {}), ...(patch.names ? { names: patch.names } : {}) }, ...(patch.search !== undefined ? { policySearch: patch.search } : {}), ...(patch.mode ? { _policyEdited: true } : {}) })), row, 'tool-policy', editor.policySearch ?? '', pendingSave)) : h('p', { className: 'mcp-muted' }, t('policyUnavailable')),
          supportsTimeout(snapshot) ? field('toolTimeout', 'timeoutSeconds', { type: 'number', value: editor.timeoutSeconds, onChange: changeDraft('timeoutSeconds'), min: 1, max: 3600, step: 1, required: true, disabled: busy || pendingSave }, 'toolTimeoutNote') : h('p', { className: 'mcp-muted' }, t('timeoutUnavailable'))));
    }
    function serverEditor(inline = false) {
      // One shared form and unchanged write-only refs/save guards. Editing stays
      // inside its owning card; creation uses the separate new-server region.
      return h('form', { key: editor.id ?? 'new-server', className: inline ? 'mcp-fields mcp-inline-editor' : 'mcp-card', onSubmit: save, 'aria-label': t(editor.id ? 'edit' : 'add'), 'data-server-editor': editor.id ?? 'new', 'data-editor-placement': inline ? 'inline' : editor.id ? 'missing' : 'new' }, h('fieldset', { className: 'mcp-fields', disabled: busy || loadFailed },
        h('legend', null, t(editor.id ? 'edit' : 'add')),
        h('p', { className: 'mcp-muted' }, t('saveActivationNote')),
        needsReload && h('p', { className: 'mcp-error' }, t('reloadSaveHost')),
        h('div', { className: 'mcp-type-choice', role: 'group', 'aria-label': t('transport') }, button('http', () => editDraft((draft) => ({ ...draft, transport: 'streamable-http' })), loadFailed, { 'aria-pressed': editor.transport === 'streamable-http' }), button('stdio', () => editDraft((draft) => ({ ...draft, transport: 'stdio' })), loadFailed, { 'aria-pressed': editor.transport === 'stdio' })),
        field('label', 'label', { ref: editorFirstField, value: editor.label, onChange: changeDraft('label'), required: true, maxLength: 80 }),
        h('details', { className: 'mcp-disclosure' }, h('summary', null, t('transport')), h('p', { className: 'mcp-muted' }, t('transportNote'))),
        editor.transport === 'stdio' ? h(React.Fragment, null, field('command', 'command', { value: editor.command, onChange: changeDraft('command'), required: true, maxLength: 1024, placeholder: 'node / npx / python / /absolute/path' }, 'commandNote'), field('args', 'args', { value: editor.args, onChange: changeDraft('args'), multiline: true, required: true, maxLength: 132000, placeholder: '["/path/to/server.js"]' }, 'argsNote'), field('cwd', 'cwd', { value: editor.cwd, onChange: changeDraft('cwd'), maxLength: 1024 })) : h(React.Fragment, null, h('h3', { 'data-http-credentials': true }, t('tokenAndHeaders')), field('url', 'url', { value: editor.url, onChange: changeDraft('url'), required: true, maxLength: 2048, inputMode: 'url', placeholder: 'https://example.com/mcp' }, 'urlNote'), tokenField()),
        editorMappings(), editorVaultSetup(), editorAdvanced(), h('div', { className: 'mcp-actions' }, h(Button, { type: 'submit', disabled: busy || loadFailed }, t(editor._pendingToken && editor.transport === 'streamable-http' ? 'retryTokenSave' : 'save')), button('cancel', cancelEditor))));
    }
    function serverControls(row) {
      const { config, state, lastVerifiedAt } = row;
      const guard = activationGuard(snapshot, row), persistent = persistentRow(snapshot, row), checked = integrationChecked(snapshot, row), recovery = recoveryMethod(snapshot, row);
      const recoveryLabel = recovery === 'stop' ? 'retryStopAction' : 'reconnectAction';
      const notConnected = persistent && checked && (state === 'disabled' || state === 'unmounted-shutdown-unverified');
      const pending = verifying === config.id;
      const unconfirmed = Object.hasOwn(uncertain, config.id);
      const displayState = pending ? 'verifying' : unconfirmed ? 'mounted-status-unavailable' : state;
      const statusLabel = pending ? t('verifying') : unconfirmed ? t('statusUnconfirmed') : t(notConnected ? 'notConnected' : state);
      const open = infoOpen?.id === config.id;
      const bubbleId = id + '-info-' + config.id;
      return h('div', { className: 'mcp-compact-row' },
        h('h3', { className: 'mcp-server-name', title: config.label }, config.label),
        h('div', { className: 'mcp-info', ref: open ? infoRoot : undefined,
          onMouseEnter: () => setInfoOpen((previous) => previous?.id === config.id ? previous : { id: config.id, pinned: false }),
          onMouseLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInfoOpen((previous) => previous?.id === config.id && !previous.pinned ? null : previous); },
          onFocus: () => { if (!infoFocusGuard.current) setInfoOpen((previous) => previous?.id === config.id ? previous : { id: config.id, pinned: false }); },
          onBlur: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setInfoOpen((previous) => previous?.id === config.id && !previous.pinned ? null : previous); } },
          h(Button, { type: 'button', variant: 'outline', className: 'mcp-row-icon', 'aria-label': t('serverInfo') + ': ' + config.label, title: t('serverInfo'), 'aria-expanded': open, 'aria-controls': open ? bubbleId : undefined, 'aria-describedby': open ? bubbleId : undefined,
            onClick: () => setInfoOpen((previous) => previous?.id === config.id && previous.pinned ? null : { id: config.id, pinned: true }) },
            h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true, focusable: 'false' }, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 10v7M12 7v.5' }))),
          open && h('div', { ref: infoPopup, id: bubbleId, className: 'mcp-info-bubble', popover: 'manual', style: { display: 'none' }, role: 'note', tabIndex: 0, 'aria-label': t('serverInfo') },
            h('div', { className: 'mcp-info-content' },
              h('p', null, t(persistent ? 'persistentIntegrationNote' : 'integrationNote')), h('p', null, t(notConnected ? 'notConnected' : state)),
              unconfirmed && h('p', null, t('statusUnconfirmed')),
              Object.hasOwn(en.errors, row.lastFailure) && h('p', { className: 'mcp-error' }, t('errors.' + row.lastFailure)),
              state === 'activation-verified' && h('p', null, validVerificationTime(lastVerifiedAt) ? t('verifiedAt') + ': ' + new Date(lastVerifiedAt).toLocaleString(dateLocale(t)) : t('verificationTimeUnavailable')),
              h('p', null, t('verificationNote')), h('p', null, t(persistent ? 'persistentStatusNote' : 'statusNote')),
              (state === 'stop-failed' || state === 'unmounted-shutdown-unverified') && h('p', { className: 'mcp-error' }, t('stoppingNote'))))),
        h('span', { className: 'mcp-status', 'data-state': displayState, role: pending ? 'status' : undefined, 'aria-live': pending ? 'polite' : undefined, 'aria-label': statusLabel, title: statusLabel },
          h('span', { className: 'mcp-status-symbol' + (pending ? ' mcp-spinner' : ''), 'aria-hidden': true }, pending ? null : stateSymbol[displayState]),
          pending ? h('span', { className: 'mcp-sr-only' }, t('verifying')) : h('span', { className: 'mcp-status-copy' }, h('span', { className: 'mcp-status-label' }, t(notConnected && !pending && !unconfirmed ? 'compactNotConnected' : compactState[displayState])), !unconfirmed && state === 'activation-verified' && h(VerificationTime, { value: lastVerifiedAt, t }))),
        h(Button, { type: 'button', variant: 'outline', className: 'mcp-row-icon', disabled: busy || !recovery || loadFailed || pendingSave || !schemas[recovery], 'aria-label': t(recoveryLabel) + ': ' + config.label, title: t(recoveryLabel) + (recovery === 'reconnect' && !schemas.reconnect ? '. ' + t('reconnectUnavailable') : ''),
          onClick: () => reconnectServer(row, snapshot.revision, guard) },
          h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true, focusable: 'false' }, h('path', { d: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6M20 7l-3 3', strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        h('div', { className: 'mcp-integration' }, h(Switch, { label: t('integration') + ': ' + config.label, checked, 'aria-checked': checked, disabled: busy || loadFailed || pendingSave, onChange: (wanted) => toggleIntegration(row, snapshot.revision, guard, wanted) })));
    }
    const automaticSecretTools = automatic && (editor?.transport === 'stdio' || snapshot.servers.some(({ config }) => config.transport === 'stdio') || Boolean(secretEditor));
    const connectionConfirmation = confirmation?.kind === 'start';
    const confirmationTitle = confirmation?.kind === 'start' ? 'confirmTitle' : confirmation?.kind === 'secret' ? 'deleteSecretTitle' : 'confirmDelete';
    return h('section', { ref: root, className: 'personal-mcp-console', 'aria-label': t('title'), 'aria-busy': busy },
      h('h2', null, h(McpHeadingMark), t('title')), h('p', { className: 'mcp-muted' }, t('intro')),
      h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true, className: notice?.error ? 'mcp-error' : 'mcp-notice' }, notice?.text ?? ''),
      h('div', { className: 'mcp-actions' }, button('add', () => { clearInputs(); setConfirmation(null); setSecretEditor(null); editorFocusRequest.current++; editDraft(observedDraft(null, observedSnapshot.current ?? snapshot)); }, !snapshot || loadFailed || snapshot.servers.length >= 32, { 'data-primary': true }), button('refresh', () => refresh(true), false, { title: t('refreshNote') }), !snapshot && button('lock', () => run('lock'))),
      h('details', { className: 'mcp-disclosure' }, h('summary', null, t('scopeTitle')), h('p', { className: 'mcp-muted' }, t('scopeNote')), h('p', { className: 'mcp-muted' }, t(snapshot?.capabilities?.persistentActivation === true ? 'persistentStatusNote' : 'statusNote'))),
      !snapshot ? h('div', { className: 'mcp-card' }, loadFailed ? h(React.Fragment, null, h('h3', null, t('serviceTitle')), h('p', { className: 'mcp-muted' }, t('serviceNote'))) : h('p', null, t('loading'))) : h(React.Fragment, null,
        loadFailed && h('p', { className: 'mcp-error' }, t('serviceNote')),
        editor && !editor.id && serverEditor(),
        h('h3', null, t('ownedTitle')),
        snapshot.servers.length === 0 && h('div', { className: 'mcp-card mcp-empty' }, h('p', { className: 'mcp-muted' }, t('empty'))),
        h('ul', { className: 'mcp-rows', 'aria-label': t('ownedTitle') }, ...snapshot.servers.map((row) => { const { config, serverName, state } = row, guard = activationGuard(snapshot, row), editing = editor?.id === config.id; return h('li', { className: 'mcp-card mcp-server', key: config.id, 'data-server-id': config.id },
          serverControls(row),
          h('details', { className: 'mcp-disclosure', open: editing ? true : undefined }, h('summary', null, t('review')), h('p', { className: 'mcp-muted' }, t('ownedSource')), h('code', { className: 'mcp-muted' }, serverName),
            editing ? serverEditor(true) : h(React.Fragment, null, h(ConfigDetails, { config, t, hideRefs: automatic }),
              h('div', { className: 'mcp-actions' }, button('edit', () => editServer(row, snapshot.revision, guard), activeState(state) || loadFailed, { 'aria-describedby': activeState(state) ? id + '-edit-blocked-' + config.id : undefined }),
                button('remove', () => removeServer(row, snapshot.revision, guard), activeState(state) || loadFailed, { 'data-danger': true })),
              activeState(state) && h('p', { className: 'mcp-muted', id: id + '-edit-blocked-' + config.id }, t('targetEditBlocked'))),
             serverPolicy(row))); })),
        policyEditor && !snapshot.servers.some(({ config }) => config.id === policyEditor.id) && h('div', { className: 'mcp-fields', 'data-missing-policy-target': policyEditor.id }, h('p', { className: 'mcp-error' }, t('policyRefreshRequired')), button('cancel', () => editPolicy(null))),
        // A disappeared target must not silently drop an uncertain Save/secret
        // ledger or turn into Add. Keep its guarded Edit draft visible to cancel
        // or reconcile explicitly; the existing save path rejects missing IDs.
        editor?.id && !snapshot.servers.some(({ config }) => config.id === editor.id) && h('div', { className: 'mcp-fields', 'data-missing-editor-target': editor.id }, h('p', { className: 'mcp-error', role: 'alert' }, t('conflict')), serverEditor()),
        automatic ? h(React.Fragment, null, h('details', { className: 'mcp-disclosure' }, h('summary', null, t('automaticSecurity')), h('p', { className: 'mcp-muted' }, t('automaticSecurityNote'))), automaticSecretTools && advancedSecretControls()) : outdatedHost ? h('p', { className: 'mcp-muted' }, t('reloadAutomaticHost')) : h('details', { className: 'mcp-card mcp-disclosure', 'data-legacy-vault': true }, h('summary', null, t('legacyVault')), button('lock', () => run('lock')), h('div', { className: 'mcp-head' }, h('h3', null, t('vaultTitle')), h('span', { className: 'mcp-tag' }, t(snapshot.vault.locked ? 'locked' : 'unlocked'))), h('details', { className: 'mcp-disclosure' }, h('summary', null, t('vaultSecurity')), h('p', { className: 'mcp-muted' }, t('vaultNote')), h('p', { className: 'mcp-muted' }, t('secretsNote'))),
          snapshot.vault.locked ? h('form', { className: 'mcp-fields', onSubmit: passphraseSubmit, 'aria-label': t(snapshot.vault.initialized ? 'unlock' : 'initialize') }, field('passphrase', 'passphrase', { type: 'password', required: true, minLength: 12, maxLength: 512, autoComplete: 'new-password', disabled: busy || loadFailed }), h('div', { className: 'mcp-actions' }, h(Button, { type: 'submit', disabled: busy || loadFailed }, t(snapshot.vault.initialized ? 'unlock' : 'initialize')))) : advancedSecretControls()),
        h('div', { className: 'mcp-card' }, h('h3', null, t('externalTitle')), h('p', { className: 'mcp-muted' }, t('externalNote')), snapshot.externalInventory === 'unavailable' ? h('p', { className: 'mcp-muted' }, t('unavailable')) : !snapshot.external.length && h('p', { className: 'mcp-muted' }, t('externalEmpty')), h('ul', { className: 'mcp-rows' }, ...snapshot.external.map(({ serverName }) => h('li', { key: serverName }, h('code', null, serverName), h('p', { className: 'mcp-muted' }, t('externalSource'))))))),
      h(Modal, { open: !!confirmation, onClose: () => { if (!busy) setConfirmation(null); }, title: t(confirmationTitle), description: t(confirmation?.kind === 'start' ? 'confirmText' : confirmation?.kind === 'secret' ? 'deleteSecretNote' : 'deleteNote'), closeLabel: t('close'), footer: h(React.Fragment, null,
        button('cancel', () => setConfirmation(null), false, { 'data-modal-autofocus': true }),
        button(confirmation?.kind === 'start' ? 'confirmStart' : 'remove', confirm, !snapshot || loadFailed || (connectionConfirmation && !acknowledged), { 'data-danger': !connectionConfirmation })) },
        confirmation && h('div', { className: 'personal-mcp-console' },
          confirmation.config ? h(ConfigDetails, { config: confirmation.config, t, hideRefs: automatic }) : h('code', null, confirmation.ref),
          !connectionConfirmation && h('p', { className: 'mcp-muted' }, t('scopeNote')),
          connectionConfirmation && h(Checkbox, { label: t('acknowledge'), checked: acknowledged, disabled: busy, onChange: setAcknowledged }),
          notice?.error && h('p', { role: 'alert', className: 'mcp-error' }, notice.text))));
  }
  const inject = ['remote', 'slots', 'locale', 'connection'];
  async function apply(ctx) {
    await ctx.remote.$mount(makeClientContribution(z));
    // The native Remote guard checks the CURRENT Cordis fiber’s namespace
    // dependencies. Publishing descriptors is not permission to access the new
    // namespace from this parent fiber. Wait for it dynamically AFTER $mount;
    // putting this namespace in static inject would deadlock its own publication.
    ctx.inject(['remote.personalMcpConsole', 'slots', 'locale', 'connection'], installUi);
  }
  function installUi(ctx) {
    const locale = 'personal.mcpConsole';
    const english = localeDictionary(en), portuguese = localeDictionary(pt), chinese = localeDictionary(zh);
    ctx.effect(() => ctx.locale.register(locale, { en: english, 'pt-BR': portuguese, pt: portuguese, zh: chinese, 'zh-CN': chinese, 'zh-Hans': chinese }), 'mcp-console: dictionaries');
    ctx.effect(() => {
      const tag = document.createElement('style'); tag.dataset.plugin = '@masspedro/dsh-mcp-console'; tag.textContent = css; document.head.appendChild(tag);
      return () => tag.remove();
    }, 'mcp-console: styles');
    let lastSnapshotCategory, snapshotVerified = false;
    const api = async (method, request) => {
      if (!METHODS.includes(method) || !schemas[method].safeParse(request).success) throw { consoleCode: 'invalid-input' };
      if (method === 'setToolPolicy') checkedPolicy(request.toolPolicy, request.id);
      const fail = (consoleCode, rpcCategory) => {
        // Android captures browser warnings. Emit ONE fixed category string only;
        // never pass the error object/message, arguments, credentials or results.
        if (method === 'snapshot') {
          snapshotVerified = false;
          if (lastSnapshotCategory !== rpcCategory) {
            lastSnapshotCategory = rpcCategory;
            console.warn('[personal-mcp-console] snapshot category=' + rpcCategory);
          }
        }
        throw { consoleCode, rpcCategory };
      };
      let result;
      try { result = await ctx.remote.personalMcpConsole[method](request); }
      catch (error) { const code = ownData(error, 'code'); fail(code === 'remote-access/denied' ? 'owner-required' : fixedConsoleCode(error), safeRpcCategory(code, 'uncategorized-transport')); }
      if (ownData(result, 'ok') !== true) {
        const error = ownData(result, 'error'), code = ownData(error, 'code');
        fail(code === 'remote-access/denied' ? 'owner-required' : fixedConsoleCode(error), safeRpcCategory(code, 'uncategorized-rpc'));
      }
      const parsed = snapshotSchema.safeParse(ownData(result, 'value'));
      if (!parsed.success) fail('snapshot-contract-failed', 'snapshot-contract-failed');
      if (method === 'snapshot') {
        if (!snapshotVerified) console.info('[personal-mcp-console] snapshot verified');
        snapshotVerified = true;
        lastSnapshotCategory = undefined;
      }
      return parsed.data;
    };
    const watch = (listener) => ctx.connection.generation.subscribe(listener);
    const t = ctx.locale.bind(locale);
    // Official Settings page cell: Models=10, built-in plugins=15 in SDK rc.2.
    ctx.slots.inject('settings.section', () => {
      const offSection = ctx.slots.register({ name: 'settings.section', id: 'personal-mcp-console', order: 12, label: () => t('nav'), locale, inject: () => ({ api, watch }) }, Panel);
      return offSection;
    });
  }
  return { inject, apply, makeClientContribution, createServerDraft, serverFromDraft, infoViewport, infoBounds, infoGeometry, absoluteInfoGeometry };
} });
