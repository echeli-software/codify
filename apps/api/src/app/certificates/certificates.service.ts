import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Certificate } from '@prisma/client';
import {
  encodeSerial,
  isCourseComplete,
  isValidSerial,
  normalizeSerial,
  SERIAL_ENTROPY_BYTES,
} from '@codify/domain';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from '../prisma/prisma-errors.js';

export interface CertificateView {
  serial: string;
  recipientName: string;
  courseTitle: string;
  isCapstone: boolean;
  issuedAt: string;
  courseId: string;
}

@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Issue (idempotently) a certificate when the user has completed the course. */
  async claim(userId: string, courseId: string): Promise<CertificateView> {
    const existing = await this.prisma.certificate.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) return this.toView(existing);

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
    });
    if (!course || course.status !== 'PUBLISHED')
      throw new NotFoundException('Course not found');

    const lessonIds = (
      await this.prisma.lesson.findMany({
        where: { deletedAt: null, module: { courseId } },
        select: { id: true },
      })
    ).map((l) => l.id);
    const completed = await this.prisma.progress.count({
      where: { userId, lessonId: { in: lessonIds } },
    });
    if (!isCourseComplete(lessonIds.length, completed)) {
      throw new BadRequestException('Course is not complete yet');
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { displayName: true },
    });
    const courseTitle = await this.resolveCourseTitle(
      courseId,
      course.sourceLocale,
      course.slug,
    );

    // Retry on the (tiny) chance of a serial collision.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const cert = await this.prisma.certificate.create({
          data: {
            userId,
            courseId,
            serial: this.newSerial(),
            recipientName: user.displayName,
            courseTitle,
            isCapstone: course.isCapstone,
          },
        });
        return this.toView(cert);
      } catch (err) {
        if (isUniqueViolation(err)) {
          // userId+courseId conflict → another request issued it; return that.
          const dup = await this.prisma.certificate.findUnique({
            where: { userId_courseId: { userId, courseId } },
          });
          if (dup) return this.toView(dup);
          continue; // serial collision → retry with a fresh serial
        }
        throw err;
      }
    }
    throw new BadRequestException('Could not issue certificate');
  }

  async listMine(userId: string): Promise<CertificateView[]> {
    const certs = await this.prisma.certificate.findMany({
      where: { userId },
      orderBy: { issuedAt: 'desc' },
    });
    return certs.map((c) => this.toView(c));
  }

  /**
   * Public verification by serial. Accepts both the legacy CDFY-XXXX-XXXX
   * and the current 80-bit CDFY-XXXX-XXXX-XXXX-XXXX format; input is
   * normalized (case, whitespace, O/I typos) before lookup.
   */
  async verify(serial: string): Promise<CertificateView | null> {
    const normalized = normalizeSerial(serial);
    if (!isValidSerial(normalized)) return null;
    const cert = await this.prisma.certificate.findUnique({
      where: { serial: normalized },
    });
    return cert ? this.toView(cert) : null;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** 80 bits from the CSPRNG → CDFY-XXXX-XXXX-XXXX-XXXX. */
  private newSerial(): string {
    return encodeSerial(randomBytes(SERIAL_ENTROPY_BYTES));
  }

  private async resolveCourseTitle(
    courseId: string,
    sourceLocale: string,
    fallbackSlug: string,
  ): Promise<string> {
    const t = await this.prisma.contentTranslation.findFirst({
      where: {
        entityType: 'COURSE',
        entityId: courseId,
        field: 'title',
        locale: sourceLocale,
      },
      select: { value: true },
    });
    return t?.value || fallbackSlug;
  }

  private toView(c: Certificate): CertificateView {
    return {
      serial: c.serial,
      recipientName: c.recipientName,
      courseTitle: c.courseTitle,
      isCapstone: c.isCapstone,
      issuedAt: c.issuedAt.toISOString(),
      courseId: c.courseId,
    };
  }
}

/** Branded SVG certificate (server-rendered, shareable/printable). */
export function renderCertificateSvg(cert: CertificateView): string {
  const esc = (s: string) =>
    s.replace(
      /[<>&]/g,
      (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[ch] as string,
    );
  const date = new Date(cert.issuedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const kind = cert.isCapstone
    ? 'Capstone Certificate'
    : 'Certificate of Completion';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="848" viewBox="0 0 1200 848" role="img" aria-label="${esc(kind)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="848" fill="url(#bg)"/>
  <rect x="40" y="40" width="1120" height="768" fill="none" stroke="#7c5cff" stroke-width="4" rx="16"/>
  <text x="600" y="150" text-anchor="middle" fill="#7c5cff" font-family="Georgia, serif" font-size="34" letter-spacing="6">CODIFY</text>
  <text x="600" y="250" text-anchor="middle" fill="#e2e8f0" font-family="Georgia, serif" font-size="44">${esc(kind)}</text>
  <text x="600" y="320" text-anchor="middle" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="22">This certifies that</text>
  <text x="600" y="410" text-anchor="middle" fill="#ffffff" font-family="Georgia, serif" font-size="60" font-weight="bold">${esc(cert.recipientName)}</text>
  <text x="600" y="480" text-anchor="middle" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="22">has successfully completed</text>
  <text x="600" y="555" text-anchor="middle" fill="#e2e8f0" font-family="Georgia, serif" font-size="40">${esc(cert.courseTitle)}</text>
  <text x="600" y="700" text-anchor="middle" fill="#94a3b8" font-family="Helvetica, Arial, sans-serif" font-size="20">${esc(date)}</text>
  <text x="600" y="740" text-anchor="middle" fill="#7c5cff" font-family="monospace" font-size="22" letter-spacing="2">${esc(cert.serial)}</text>
  <text x="600" y="772" text-anchor="middle" fill="#64748b" font-family="Helvetica, Arial, sans-serif" font-size="15">Verify at codify.app/verify/${esc(cert.serial)}</text>
</svg>`;
}
