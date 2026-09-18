export type UserRole = 'owner' | 'tenant';

export type RentalStatus = 'pago' | 'pendente' | 'vencido' | 'aguardando_confirmacao';

export type GateStatus = 'aberto' | 'fechado';

export type TicketCategory = 'Eletrica' | 'Hidraulica' | 'Estrutural' | 'Paisagismo' | 'Outro';

export type TicketUrgency = 'Baixa' | 'Media' | 'Alta' | 'Emergencia';

export type TicketStatus = 'Pendente' | 'Em andamento' | 'Concluido' | 'Cancelado';

export interface AppUser {
  id: string;
  nome: string;
  email: string;
  telefone?: string;
  casaId?: string;
  role: UserRole;
  isOwner: boolean;
  ativo: boolean;
  photoURL?: string;
  createdAt?: string;
}

export interface House {
  id: string;
  nome: string;
  numero: string;
  aluguelMensal: number;
  diaVencimento: number;
  dataInicioContrato?: string;
  fotoFachadaUrl?: string;
  moradores?: Array<{
    nome: string;
    fotoUrl?: string;
    contato?: string;
    cpf?: string;
    telefone?: string;
    email?: string;
    parentesco?: string;
    dataNascimento?: string;
    observacoes?: string;
  }>;
  veiculos?: string[];
  pets?: Array<{
    nome: string;
    especie: string;
    raca?: string;
  }>;
}

export interface RentalPayment {
  id: string;
  competencia: string;
  valor: number;
  status: RentalStatus;
  tipo?: 'aluguel' | 'luz';
  dataPagamento?: string;
  formaPagamento?: 'Pix' | 'Dinheiro' | 'Transferencia';
  reciboUrl?: string;
  boletoPdfUrl?: string;
  comprovantePagamentoUrl?: string;
  marcadoComoPagoPeloInquilino?: boolean;
}

export interface MaintenanceTicket {
  id: string;
  titulo: string;
  descricao: string;
  categoria: TicketCategory;
  urgencia: TicketUrgency;
  status: TicketStatus;
  casaId: string;
  casaNome?: string;
  criadorId: string;
  criadorNome: string;
  fotos?: string[];
  prestador?: string;
  prazoEstimado?: string;
  comentarios?: Array<{
    autorId: string;
    autorNome: string;
    texto: string;
    data: string;
  }>;
  criadoEm: string;
  fechadoEm?: string;
}

export interface Notice {
  id: string;
  titulo: string;
  texto: string;
  imagemUrl?: string;
  pinned: boolean;
  criadoEm: string;
  alvoCasaId?: string | null;
  autorId: string;
  autorNome: string;
  leitores?: string[];
}

export interface ChatMessage {
  id: string;
  chatId: string;
  texto?: string;
  imagemUrl?: string;
  audioUrl?: string;
  audioDurationMs?: number;
  replyTo?: {
    messageId: string;
    senderId: string;
    senderName: string;
    text?: string;
    imageUrl?: string;
    audioUrl?: string;
  } | null;
  enviadoPor: string;
  enviadoPorNome: string;
  enviadoPorFotoURL?: string;
  enviadoEm: string;
  lidoPor?: string[];
}

export type PrivateChatThreadStatus = 'aberto' | 'concluido';

export interface PrivateChatThread {
  id: string;
  baseChatId: string;
  ownerId: string;
  tenantId: string;
  participantIds: string[];
  title: string;
  status: PrivateChatThreadStatus;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  closedById?: string;
  closedByName?: string;
  autoTitleGenerated?: boolean;
  autoTitleUpdatedAt?: string;
  autoTitleMessageCount?: number;
}

export interface Visitor {
  id: string;
  moradorId: string;
  moradorNome: string;
  nome: string;
  fotoUrl?: string;
  status: 'Esperado' | 'No portao' | 'Liberado' | 'Negado';
  criadoEm: string;
  atualizadoEm: string;
}

export interface EmergencyContact {
  id: string;
  nome: string;
  telefone: string;
  especialidade: string;
  icon?: string;
}

export interface HouseDocument {
  id: string;
  titulo: string;
  tipo: 'contrato' | 'vistoria' | 'caucao' | 'outro';
  arquivoUrl: string;
  criadoEm?: string;
}

export interface CameraConfig {
  id: string;
  nome: string;
  rtspUrl: string;
  playbackUrl?: string;
  playbackUrlExternal?: string;
  casasPermitidas: string[];
  ativo: boolean;
  criadoEm?: string;
  atualizadoEm?: string;
}

export interface GateHouseAccessRule {
  houseId: string;
  enabled?: boolean;
  windowStart?: string;
  windowEnd?: string;
  cooldownSeconds?: number;
  maxOpensPerDay?: number;
  requireProximity?: boolean;
  maxDistanceMeters?: number;
  requireBiometric?: boolean;
  accessPin?: string;
}

export interface GateTenantAccessConfig {
  enabled: boolean;
  defaultWindowStart: string;
  defaultWindowEnd: string;
  defaultCooldownSeconds: number;
  defaultMaxOpensPerDay: number;
  defaultRequireProximity: boolean;
  defaultMaxDistanceMeters: number;
  defaultRequireBiometric: boolean;
  houseRules?: GateHouseAccessRule[];
}

export interface HeadlightConfig {
  id: string;
  nome: string;
  descricao?: string;
  casasPermitidas?: string[];
  ativo?: boolean;
}

export interface AppConfig {
  id?: string;
  propriedadeNome: string;
  fotoCapaUrl?: string;
  chavePix: string;
  gateWebhookUrl?: string;
  gateCloseWebhookUrl?: string;
  tenantGateAccess?: GateTenantAccessConfig;
  headlights?: HeadlightConfig[];
  tarifaEnergia: number;
  latitude?: number;
  longitude?: number;
  temaEscuroAtivo: boolean;
  notificacoes: {
    avisos: boolean;
    chamados: boolean;
    financeiro: boolean;
    chat: boolean;
    visitantes: boolean;
  };
}

export interface WeatherDay {
  date: string;
  tempMin: number;
  tempMax: number;
  description: string;
  icon: string;
}
