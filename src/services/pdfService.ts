import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { RentalPayment } from '../types/models';
import { formatCurrencyBRL, formatDateBR } from '../utils/format';

interface ReceiptPayload {
  tenantName: string;
  houseName: string;
  payment: RentalPayment;
  ownerName: string;
}

interface ChargePayload {
  tenantName: string;
  houseName: string;
  competencia: string;
  valor: number;
  dueDay?: number;
  pixKey?: string;
  ownerName: string;
}

export const generateReceiptPdf = async ({ tenantName, houseName, payment, ownerName }: ReceiptPayload) => {
  const html = `
    <html>
      <body style="font-family: Arial; padding: 24px; color: #1B1D1B;">
        <h1 style="color: #2D5A27;">Recibo de Aluguel</h1>
        <p><strong>Inquilino:</strong> ${tenantName}</p>
        <p><strong>Casa:</strong> ${houseName}</p>
        <p><strong>Competencia:</strong> ${payment.competencia}</p>
        <p><strong>Valor:</strong> ${formatCurrencyBRL(payment.valor)}</p>
        <p><strong>Data do pagamento:</strong> ${formatDateBR(payment.dataPagamento)}</p>
        <p><strong>Forma de pagamento:</strong> ${payment.formaPagamento ?? 'Nao informada'}</p>
        <hr />
        <p style="margin-top: 32px;">Assinatura digital:</p>
        <p style="font-weight: bold;">${ownerName}</p>
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });

  return uri;
};

export const generateChargePdf = async ({
  tenantName,
  houseName,
  competencia,
  valor,
  dueDay,
  pixKey,
  ownerName,
}: ChargePayload) => {
  const html = `
    <html>
      <body style="font-family: Arial; padding: 24px; color: #1B1D1B;">
        <h1 style="color: #8A5B00;">Cobranca de Aluguel</h1>
        <p><strong>Inquilino:</strong> ${tenantName}</p>
        <p><strong>Casa:</strong> ${houseName}</p>
        <p><strong>Competencia:</strong> ${competencia}</p>
        <p><strong>Valor em aberto:</strong> ${formatCurrencyBRL(valor)}</p>
        <p><strong>Vencimento:</strong> ${dueDay ? `dia ${dueDay}` : 'Nao informado'}</p>
        <p><strong>Chave Pix para pagamento:</strong> ${pixKey?.trim() ? pixKey : 'Nao configurada'}</p>
        <hr />
        <p style="margin-top: 32px;">Emitido por:</p>
        <p style="font-weight: bold;">${ownerName}</p>
        <p style="font-size: 12px; color: #666;">Data de emissao: ${formatDateBR(new Date().toISOString())}</p>
      </body>
    </html>
  `;

  const { uri } = await Print.printToFileAsync({ html });
  return uri;
};

export const sharePdf = async (uri: string) => {
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Compartilhar recibo',
      UTI: 'com.adobe.pdf',
    });
  }
};
