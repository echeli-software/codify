import type { NotificationKind } from '@prisma/client';

/**
 * Server-side copy for notifications this area sends (inbox, push and
 * email), picked by `User.locale` like the other server copy: pt-* →
 * pt-BR, anything else → en-US.
 */

export type CopyLocale = 'pt-BR' | 'en-US';

export function copyLocale(locale: string | null | undefined): CopyLocale {
  return (locale ?? 'pt-BR').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
}

export interface Copy {
  title: string;
  body: string;
}

const pick = <T>(locale: string | null | undefined, pt: T, en: T): T =>
  copyLocale(locale) === 'pt-BR' ? pt : en;

const fmtInt = (n: number, locale: string | null | undefined) =>
  new Intl.NumberFormat(copyLocale(locale)).format(n);

export function welcomeCopy(locale: string, name: string): Copy {
  return pick(
    locale,
    {
      title: `Bem-vindo ao Codify, ${name}!`,
      body: 'Sua primeira lição leva só alguns minutos. Complete as missões do dia para ganhar XP e moedas.',
    },
    {
      title: `Welcome to Codify, ${name}!`,
      body: 'Your first lesson takes just a few minutes. Finish the daily quests to earn XP and coins.',
    },
  );
}

export function dailyQuestReminderCopy(locale: string): Copy {
  return pick(
    locale,
    {
      title: '🎯 Suas missões de hoje estão esperando',
      body: 'Uma lição rápida já avança suas missões diárias.',
    },
    {
      title: '🎯 Your daily quests are waiting',
      body: 'One quick lesson moves your daily quests forward.',
    },
  );
}

export function streakReminderCopy(locale: string, days: number): Copy {
  return pick(
    locale,
    {
      title: '🔥 Mantenha sua sequência!',
      body: `Você está há ${days} ${days === 1 ? 'dia' : 'dias'} seguidos. Faça uma lição hoje para não perder.`,
    },
    {
      title: '🔥 Keep your streak alive!',
      body: `You're on a ${days}-day streak. Do a lesson today so you don't lose it.`,
    },
  );
}

export interface RecapStats {
  xp: number;
  lessons: number;
  streakDays: number;
}

export function weeklyRecapCopy(locale: string, s: RecapStats): Copy {
  return pick(
    locale,
    {
      title: 'Seu resumo da semana no Codify',
      body: `Na semana passada você ganhou ${fmtInt(s.xp, locale)} XP e concluiu ${fmtInt(s.lessons, locale)} ${s.lessons === 1 ? 'lição' : 'lições'}.`,
    },
    {
      title: 'Your Codify week in review',
      body: `Last week you earned ${fmtInt(s.xp, locale)} XP and finished ${fmtInt(s.lessons, locale)} ${s.lessons === 1 ? 'lesson' : 'lessons'}.`,
    },
  );
}

/** Recap stat lines (email body table). */
export function weeklyRecapLines(locale: string, s: RecapStats): string[] {
  return pick(
    locale,
    [
      `XP ganho: ${fmtInt(s.xp, locale)}`,
      `Lições concluídas: ${fmtInt(s.lessons, locale)}`,
      `Sequência atual: ${fmtInt(s.streakDays, locale)} ${s.streakDays === 1 ? 'dia' : 'dias'}`,
    ],
    [
      `XP earned: ${fmtInt(s.xp, locale)}`,
      `Lessons finished: ${fmtInt(s.lessons, locale)}`,
      `Current streak: ${fmtInt(s.streakDays, locale)} ${s.streakDays === 1 ? 'day' : 'days'}`,
    ],
  );
}

/** docs/10 §13 day 7 — one gentle email, no nagging. */
export function reactivationDay7Copy(locale: string, name: string): Copy {
  return pick(
    locale,
    {
      title: `${name}, seu progresso está guardado`,
      body: 'Seus bloqueios de sequência acabaram, mas tudo o que você aprendeu continua aqui. Uma lição curta é o suficiente para voltar.',
    },
    {
      title: `${name}, your progress is saved`,
      body: "Your streak freezes are gone, but everything you've learned is still here. One short lesson is all it takes to get back in.",
    },
  );
}

/** docs/10 §13 day 14 — the welcome-back quest is the content reason. */
export function welcomeBackQuestCopy(locale: string, coins: number): Copy {
  return pick(
    locale,
    {
      title: '🎁 Uma missão de boas-vindas te espera',
      body: `Volte e conclua 1 lição para ganhar ${fmtInt(coins, locale)} moedas.`,
    },
    {
      title: '🎁 A welcome-back quest is waiting',
      body: `Come back and finish 1 lesson to earn ${fmtInt(coins, locale)} coins.`,
    },
  );
}

/** Title of the welcome-back quest template (one template per locale). */
export function welcomeBackQuestTitle(locale: CopyLocale): string {
  return locale === 'pt-BR'
    ? 'Bem-vindo de volta: conclua 1 lição'
    : 'Welcome back: finish 1 lesson';
}

/** docs/10 §13 day 30 — a single win-back offer. */
export function winbackCopy(locale: string): Copy {
  return pick(
    locale,
    {
      title: 'Uma oferta especial para você voltar',
      body: 'Por tempo limitado: desconto no plano anual do Codify. Continue de onde parou.',
    },
    {
      title: 'A special offer to welcome you back',
      body: 'For a limited time: a discount on the Codify annual plan. Pick up where you left off.',
    },
  );
}

/** Billing: a payment went through (in-app + email receipt notice). */
export function paymentReceivedCopy(
  locale: string,
  amount?: { cents: number; currency: string } | null,
): Copy {
  let formatted: string | null = null;
  if (amount && Number.isFinite(amount.cents)) {
    try {
      formatted = new Intl.NumberFormat(copyLocale(locale), {
        style: 'currency',
        currency: amount.currency.toUpperCase(),
      }).format(amount.cents / 100);
    } catch {
      formatted = null;
    }
  }
  return pick(
    locale,
    {
      title: 'Pagamento recebido',
      body: formatted
        ? `Recebemos seu pagamento de ${formatted}. Obrigado por aprender com o Codify!`
        : 'Recebemos seu pagamento. Obrigado por aprender com o Codify!',
    },
    {
      title: 'Payment received',
      body: formatted
        ? `We received your payment of ${formatted}. Thanks for learning with Codify!`
        : 'We received your payment. Thanks for learning with Codify!',
    },
  );
}

// ─── Email chrome ─────────────────────────────────────────────────────────

const KIND_NAMES: Record<CopyLocale, Record<NotificationKind, string>> = {
  'pt-BR': {
    STREAK_REMINDER: 'lembretes de sequência',
    DAILY_QUEST: 'lembretes de missões diárias',
    FRIEND_NUDGE: 'cutucadas de amigos',
    LEAGUE_RESULT: 'resultados da liga',
    ITEM_DROP: 'itens limitados',
    PROMO: 'promoções',
    BILLING: 'cobrança',
    SYSTEM: 'avisos da conta',
    WELCOME: 'boas-vindas',
    WEEKLY_RECAP: 'resumo semanal',
    REACTIVATION: 'lembretes de retorno',
  },
  'en-US': {
    STREAK_REMINDER: 'streak reminder',
    DAILY_QUEST: 'daily quest reminder',
    FRIEND_NUDGE: 'friend nudge',
    LEAGUE_RESULT: 'league result',
    ITEM_DROP: 'limited drop',
    PROMO: 'promotion',
    BILLING: 'billing',
    SYSTEM: 'account notice',
    WELCOME: 'welcome',
    WEEKLY_RECAP: 'weekly recap',
    REACTIVATION: 'come-back reminder',
  },
};

export function kindName(locale: string, kind: NotificationKind): string {
  return KIND_NAMES[copyLocale(locale)][kind];
}

export interface EmailChrome {
  cta: string;
  reason: string;
  unsubscribe: string;
  settings: string;
  brand: string;
}

export function emailChrome(
  locale: string,
  kind: NotificationKind,
  locked: boolean,
): EmailChrome {
  const name = kindName(locale, kind);
  const ctaPt: Partial<Record<NotificationKind, string>> = {
    BILLING: 'Ver assinatura',
    PROMO: 'Ver oferta',
    WEEKLY_RECAP: 'Continuar aprendendo',
    WELCOME: 'Começar agora',
    REACTIVATION: 'Voltar ao Codify',
  };
  const ctaEn: Partial<Record<NotificationKind, string>> = {
    BILLING: 'View subscription',
    PROMO: 'See the offer',
    WEEKLY_RECAP: 'Keep learning',
    WELCOME: 'Get started',
    REACTIVATION: 'Back to Codify',
  };
  return pick<EmailChrome>(
    locale,
    {
      cta: ctaPt[kind] ?? 'Abrir o Codify',
      reason: locked
        ? `Você recebe este email porque ele é necessário para sua conta (${name}).`
        : `Você recebe este email porque os emails de ${name} estão ativados.`,
      unsubscribe: locked ? 'Gerenciar emails' : `Cancelar emails de ${name}`,
      settings: 'Preferências de notificação',
      brand: 'Codify',
    },
    {
      cta: ctaEn[kind] ?? 'Open Codify',
      reason: locked
        ? `You get this email because it's required for your account (${name}).`
        : `You get this email because ${name} emails are on.`,
      unsubscribe: locked ? 'Manage emails' : `Unsubscribe from ${name} emails`,
      settings: 'Notification settings',
      brand: 'Codify',
    },
  );
}

// ─── Unsubscribe page ─────────────────────────────────────────────────────

export interface UnsubscribePageCopy {
  title: string;
  body: string;
  link: string;
}

export function unsubscribePageCopy(
  locale: string,
  outcome: 'done' | 'locked' | 'invalid',
  kind?: NotificationKind,
): UnsubscribePageCopy {
  const name = kind ? kindName(locale, kind) : '';
  switch (outcome) {
    case 'done':
      return pick(
        locale,
        {
          title: 'Inscrição cancelada',
          body: `Você não vai mais receber emails de ${name}. Você pode reativá-los quando quiser nas preferências de notificação.`,
          link: 'Abrir preferências de notificação',
        },
        {
          title: "You're unsubscribed",
          body: `You won't get ${name} emails anymore. You can turn them back on anytime in your notification settings.`,
          link: 'Open notification settings',
        },
      );
    case 'locked':
      return pick(
        locale,
        {
          title: 'Este email é necessário',
          body: `Emails de ${name} não podem ser desativados enquanto sua conta estiver ativa. Você pode ajustar as outras notificações nas preferências.`,
          link: 'Abrir preferências de notificação',
        },
        {
          title: 'This email is required',
          body: `${name.charAt(0).toUpperCase()}${name.slice(1)} emails can't be turned off while your account is active. You can adjust your other notifications in settings.`,
          link: 'Open notification settings',
        },
      );
    case 'invalid':
      return pick(
        locale,
        {
          title: 'Link inválido',
          body: 'Este link de cancelamento não é válido. Ajuste seus emails nas preferências de notificação do app.',
          link: 'Abrir preferências de notificação',
        },
        {
          title: 'Invalid link',
          body: "This unsubscribe link isn't valid. You can manage your emails in the app's notification settings.",
          link: 'Open notification settings',
        },
      );
  }
}
