import { copyLocale } from '../email/copy.js';
import { escapeHtml, type RenderedEmail } from '../email/email-templates.js';

/** Where a parent can reach us (the same inbox the student app shows). */
export const GUARDIAN_SUPPORT_EMAIL = 'support@codify.app';

export interface GuardianNoticeInput {
  /** The student's locale — the notice is sent in it (pt-* → pt-BR). */
  locale: string;
  guardianName: string;
  studentName: string;
  planName: string;
  currency: string;
  amountCents: number;
  period: 'MONTHLY' | 'ANNUAL';
}

/**
 * The short notice a parent / guardian gets after confirming a minor's
 * paid plan (docs/09 "Guardian step"). Plain, transactional, no tracking
 * or call to action beyond replying; every interpolated value is escaped.
 */
export function guardianNoticeEmail(input: GuardianNoticeInput): RenderedEmail {
  const lang = copyLocale(input.locale);
  const pt = lang === 'pt-BR';
  const price = new Intl.NumberFormat(lang, {
    style: 'currency',
    currency: input.currency.toUpperCase(),
  }).format(input.amountCents / 100);
  const period = pt
    ? input.period === 'ANNUAL'
      ? 'por ano'
      : 'por mês'
    : input.period === 'ANNUAL'
      ? 'per year'
      : 'per month';

  const subject = pt
    ? `Confirmação de responsável: ${input.studentName} no Codify`
    : `Parent or guardian confirmation: ${input.studentName} on Codify`;
  const paragraphs = pt
    ? [
        `Olá, ${input.guardianName}.`,
        `${input.studentName} tem entre 12 e 17 anos e indicou você como pai, mãe ou responsável ao assinar o plano ${input.planName} (${price} ${period}) no Codify. Quem preencheu o formulário confirmou que você tem 18 anos ou mais e é responsável por essa pessoa.`,
        `A assinatura é renovada automaticamente até ser cancelada. Ela pode ser cancelada a qualquer momento em Assinatura, no app.`,
        `Se você não fez essa confirmação ou não concorda com a compra, responda a este email ou escreva para ${GUARDIAN_SUPPORT_EMAIL}. Vamos cancelar a assinatura e conversar sobre o reembolso.`,
      ]
    : [
        `Hello ${input.guardianName},`,
        `${input.studentName} is aged 12 to 17 and named you as their parent or guardian when subscribing to the ${input.planName} plan (${price} ${period}) on Codify. The person who filled in the form confirmed that you are 18 or older and this user's parent or guardian.`,
        `The subscription renews automatically until it is cancelled. It can be cancelled at any time under Subscription in the app.`,
        `If you did not give this confirmation or do not agree with the purchase, reply to this email or write to ${GUARDIAN_SUPPORT_EMAIL}. We will cancel the subscription and talk about a refund.`,
      ];
  const footer = pt
    ? 'Você recebe este email uma única vez porque foi indicado como responsável. Não enviamos outros emails para este endereço.'
    : 'You are getting this one-off email because you were named as a parent or guardian. We do not send anything else to this address.';

  const text = [...paragraphs, '', '—', footer].join('\n\n');
  const e = escapeHtml;
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2937">${e(p)}</p>`,
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px">
<tr><td style="padding:32px 28px">
<p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#4338ca">Codify</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#111827">${e(subject)}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 28px 28px;border-top:1px solid #e5e7eb">
<p style="margin:0;font-size:13px;line-height:1.5;color:#4b5563">${e(footer)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}
