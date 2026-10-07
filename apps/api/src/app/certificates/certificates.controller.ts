import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsString, Length } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import { Public } from '../auth/public.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import {
  CertificatesService,
  renderCertificateSvg,
  type CertificateView,
} from './certificates.service.js';

class ClaimDto {
  @IsString()
  @Length(1, 64)
  courseId!: string;
}

/**
 * Certificates of completion. (Referral endpoints moved to the referrals
 * module — `GET /me/referral` keeps its path and response shape.)
 */
@Controller()
export class CertificatesController {
  constructor(private readonly certs: CertificatesService) {}

  // ─── Student ──────────────────────────────────────────────────────────

  @Roles('STUDENT')
  @Post('certificates/claim')
  claim(
    @CurrentUser() actor: ApiUser,
    @Body() body: ClaimDto,
  ): Promise<CertificateView> {
    return this.certs.claim(actor.userId, body.courseId);
  }

  @Roles('STUDENT')
  @Get('me/certificates')
  mine(@CurrentUser() actor: ApiUser): Promise<CertificateView[]> {
    return this.certs.listMine(actor.userId);
  }

  // ─── Public verification ──────────────────────────────────────────────

  @Public()
  @Get('certificates/:serial')
  async verify(
    @Param('serial') serial: string,
  ): Promise<{ valid: boolean } & Partial<CertificateView>> {
    const cert = await this.certs.verify(serial);
    return cert ? { valid: true, ...cert } : { valid: false };
  }

  @Public()
  @Get('certificates/:serial/image.svg')
  async image(
    @Param('serial') serial: string,
    @Res() res: Response,
  ): Promise<void> {
    const cert = await this.certs.verify(serial);
    if (!cert) throw new NotFoundException('Certificate not found');
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(renderCertificateSvg(cert));
  }
}
