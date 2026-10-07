/**
 * Billing push copy. Translation keys aren't available server-side, so —
 * like the streak reminders — copy is picked by `User.locale` (pt-* →
 * pt-BR, anything else → en-US).
 */

export interface PushCopy {
  title: string;
  body: string;
}

const isPt = (locale: string | null | undefined) =>
  (locale ?? 'pt-BR').toLowerCase().startsWith('pt');

/** invoice.payment_failed → recovery notice (docs/09 §5 "Renewal"). */
export function paymentFailedCopy(locale: string): PushCopy {
  return isPt(locale)
    ? {
        title: 'Pagamento não aprovado',
        body: 'Não conseguimos cobrar sua assinatura Codify. Atualize sua forma de pagamento para manter o acesso.',
      }
    : {
        title: 'Payment failed',
        body: "We couldn't charge your Codify subscription. Update your payment method to keep your access.",
      };
}

/** PIX/Boleto prepay ending in ≤ 7 days → renew with PIX (docs/09 §4, §5). */
export function pixRenewalCopy(
  locale: string,
  planName: string,
  endsAt: Date,
  timeZone: string | null | undefined,
): PushCopy {
  const pt = isPt(locale);
  let date: string;
  try {
    date = endsAt.toLocaleDateString(pt ? 'pt-BR' : 'en-US', {
      day: 'numeric',
      month: 'long',
      timeZone: timeZone || 'America/Sao_Paulo',
    });
  } catch {
    date = endsAt.toISOString().slice(0, 10);
  }
  return pt
    ? {
        title: 'Seu plano termina em breve',
        body: `Seu acesso ao ${planName} termina em ${date}. Renove com PIX para continuar aprendendo.`,
      }
    : {
        title: 'Your plan ends soon',
        body: `Your ${planName} access ends on ${date}. Renew with PIX to keep learning.`,
      };
}
