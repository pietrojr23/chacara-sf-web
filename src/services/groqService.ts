import { getSupabase } from './supabase';

export interface PersonContractData {
  nome: string;
  nacionalidade: string;
  estadoCivil: string;
  profissao: string;
  rg: string;
  rgUf: string;
  cpf: string;
  endereco: string;
}

export interface RentalContractGenerationInput {
  locadora: PersonContractData;
  locatario: PersonContractData;
  fiador: PersonContractData;
  imovelDescricao: string;
  imovelEndereco: string;
  imovelMatricula: string;
  imovelCartorio: string;
  valorAluguel: number;
  diaVencimento: string;
  prazoMeses: number;
  dataInicio: string;
  formaPagamento: string;
  indiceReajusteAnual: string;
  multaAtraso: string;
  multaRescisaoAntecipada: string;
  isencaoMultaRescisaoApos: string;
  finalidade: string;
  foroComarca: string;
  cidadeAssinatura: string;
  dataAssinatura: string;
  clausulasAdicionais?: string;
}

const invokeGroq = async ({
  systemPrompt,
  userPrompt,
  temperature,
  maxTokens,
}: {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<string> => {
  const { data, error } = await getSupabase().functions.invoke('groq', {
    body: {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    },
  });

  if (error) {
    throw new Error(error.message || 'Falha ao chamar a Groq.');
  }

  const content = String((data as { content?: string })?.content ?? '').trim();
  if (!content) {
    throw new Error('A Groq não retornou conteúdo.');
  }

  return content.replace(/^```(?:text)?\s*/i, '').replace(/```$/i, '').trim();
};

const toCurrencyBR = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const formatPersonBlock = (title: string, person: PersonContractData) => `
**${title}:**
- Nome: ${person.nome}
- Nacionalidade: ${person.nacionalidade}
- Estado civil: ${person.estadoCivil}
- Profissão: ${person.profissao}
- RG: ${person.rg} - SSP/${person.rgUf}
- CPF: ${person.cpf}
- Endereço: ${person.endereco}
`.trim();

export interface ChatAiContextMessage {
  senderName: string;
  sentAt?: string;
  text?: string;
  hasImage?: boolean;
  hasAudio?: boolean;
}

const formatChatContext = (messages: ChatAiContextMessage[]) => {
  if (!messages.length) {
    return 'Sem mensagens.';
  }

  return messages
    .map((message) => {
      const sentAt = String(message.sentAt ?? '').trim();
      const prefix = sentAt ? `[${sentAt}] ` : '';
      const mediaLabel = message.hasAudio
        ? '[áudio]'
        : message.hasImage
          ? '[imagem/arquivo]'
          : '[mensagem]';
      const content = String(message.text ?? '').trim() || mediaLabel;
      return `${prefix}${message.senderName}: ${content}`;
    })
    .join('\n');
};

export const generateRentalContractWithGroq = async (input: RentalContractGenerationInput) => {
  const systemPrompt =
    'Você redige contratos de locação residenciais brasileiros com linguagem formal e estrutura jurídica completa.';
  const userPrompt = `
Você é um especialista em direito imobiliário brasileiro com amplo conhecimento na Lei do Inquilinato (Lei 8.245/91) e no Código Civil brasileiro.

Gere um INSTRUMENTO PARTICULAR DE CONTRATO DE LOCAÇÃO RESIDENCIAL COM FIADOR completo, formal e juridicamente válido no Brasil, com base nas seguintes informações:

---

${formatPersonBlock('DADOS DA LOCADORA', input.locadora)}

${formatPersonBlock('DADOS DO(S) LOCATÁRIO(S)', input.locatario)}

${formatPersonBlock('DADOS DO(S) FIADOR(ES)', input.fiador)}

**DADOS DO IMÓVEL:**
- Descrição: ${input.imovelDescricao}
- Endereço completo: ${input.imovelEndereco}
- Matrícula: ${input.imovelMatricula} do ${input.imovelCartorio}

**DADOS DA LOCAÇÃO:**
- Valor do aluguel: ${toCurrencyBR(input.valorAluguel)}
- Dia de vencimento: dia ${input.diaVencimento} de cada mês
- Prazo: ${input.prazoMeses} meses
- Início: ${input.dataInicio}
- Término: CALCULAR AUTOMATICAMENTE com base em início + prazo
- Forma de pagamento: ${input.formaPagamento}
- Índice de reajuste anual: ${input.indiceReajusteAnual}
- Multa por atraso: ${input.multaAtraso}
- Multa contratual por rescisão antecipada: ${input.multaRescisaoAntecipada}
- Isenção de multa de rescisão após: ${input.isencaoMultaRescisaoApos}
- Finalidade: ${input.finalidade}

**INSTRUÇÕES DE GERAÇÃO:**
- Utilize linguagem jurídica formal e técnica
- Inclua todas as cláusulas típicas: objeto, prazo, valor, reajuste, uso do imóvel, encargos locatícios, conservação, vistoria, cessão/sublocação, rescisão, multas, fiança, foro
- Os fiadores devem renunciar expressamente aos benefícios dos arts. 821, 823, 825, 827, 828, 834, 835, 837, 838 e 839 do Código Civil
- Inclua responsabilidade solidária dos fiadores até a entrega efetiva das chaves
- Inclua cláusula de prorrogação automática por prazo indeterminado se não houver oposição
- Foro da comarca: ${input.foroComarca}
- Finalize com espaços para assinaturas da locadora, locatário(s), fiador(es) e 2 testemunhas
- Formate o documento com numeração sequencial de cláusulas e parágrafos (§1º, §2º, etc.)
- Data e local de assinatura: ${input.cidadeAssinatura}, ${input.dataAssinatura}
- Cláusulas adicionais do contratante: ${input.clausulasAdicionais?.trim() || 'Nenhuma'}

Restrições:
- Não use markdown.
- Não use crases.
- Retorne apenas o texto final do contrato.
`.trim();

  return invokeGroq({
    systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxTokens: 3200,
  });
};

export const suggestChatReplyWithGroq = async (params: {
  chatTitle: string;
  currentUserName: string;
  messages: ChatAiContextMessage[];
}) =>
  invokeGroq({
    systemPrompt:
      'Você é um assistente de escrita para chat. Responda em português do Brasil, tom cordial, objetivo e natural.',
    userPrompt: `
Conversa: ${params.chatTitle}
Usuário que vai responder: ${params.currentUserName}

Histórico recente:
${formatChatContext(params.messages)}

Gere UMA sugestão curta de resposta (máximo 2 frases), sem aspas, sem markdown.
`.trim(),
    temperature: 0.4,
    maxTokens: 220,
  });

export const improveChatDraftWithGroq = async (params: {
  draft: string;
  chatTitle: string;
  currentUserName: string;
  messages: ChatAiContextMessage[];
}) =>
  invokeGroq({
    systemPrompt:
      'Você melhora mensagens de chat mantendo intenção, clareza e cordialidade, sem mudar fatos.',
    userPrompt: `
Conversa: ${params.chatTitle}
Usuário: ${params.currentUserName}

Histórico recente:
${formatChatContext(params.messages)}

Texto original:
${params.draft}

Reescreva para ficar mais claro e natural, mantendo o mesmo sentido. Retorne apenas o texto final, sem aspas.
`.trim(),
    temperature: 0.25,
    maxTokens: 260,
  });

export const summarizeChatWithGroq = async (params: {
  chatTitle: string;
  messages: ChatAiContextMessage[];
}) =>
  invokeGroq({
    systemPrompt:
      'Você resume conversas em português do Brasil de forma objetiva, destacando pendências e decisões. Sem aspas, sem markdown.',
    userPrompt: `
Conversa: ${params.chatTitle}

Histórico recente:
${formatChatContext(params.messages)}

Gere um resumo curto em 3 blocos:
1) O que aconteceu
2) Pendências
3) Próximo passo sugerido
`.trim(),
    temperature: 0.2,
    maxTokens: 420,
  });

export const suggestChatTopicTitleWithGroq = async (params: {
  currentTitle?: string;
  messages: ChatAiContextMessage[];
}) =>
  invokeGroq({
    systemPrompt:
      'Você cria títulos curtos para conversas em português do Brasil. Seja objetivo e específico.',
    userPrompt: `
Título atual: ${String(params.currentTitle ?? '').trim() || 'Sem título'}

Histórico recente:
${formatChatContext(params.messages)}

Gere apenas 1 título curto (3 a 7 palavras), sem aspas, sem markdown, sem emojis.
`.trim(),
    temperature: 0.2,
    maxTokens: 60,
  });
