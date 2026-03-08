import { format, formatDistanceToNowStrict, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export const formatCurrencyBRL = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);

export const formatDateBR = (dateString?: string, pattern = 'dd/MM/yyyy') => {
  if (!dateString) {
    return '-';
  }

  const date = new Date(dateString);
  if (!isValid(date)) {
    return '-';
  }

  return format(date, pattern, { locale: ptBR });
};

export const countdownDays = (dueDateIso: string) => {
  const dueDate = new Date(dueDateIso);

  if (!isValid(dueDate)) {
    return 'Sem data';
  }

  return formatDistanceToNowStrict(dueDate, {
    addSuffix: true,
    locale: ptBR,
    unit: 'day',
  });
};

export const nowIso = () => new Date().toISOString();
