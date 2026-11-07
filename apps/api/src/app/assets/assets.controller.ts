import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { AssetsService } from './assets.service.js';
import {
  ASSET_KINDS,
  PresignAssetDto,
  type AssetView,
  type PresignAssetResponse,
} from './assets.dto.js';

@Controller()
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly audit: AuditService,
  ) {}

  @Roles('ADMIN', 'TEACHER')
  @Post('assets/presign')
  @HttpCode(201)
  presign(
    @CurrentUser() actor: ApiUser,
    @Body() body: PresignAssetDto,
  ): Promise<PresignAssetResponse> {
    return this.assets.presign(actor, body);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post('assets/:id/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<AssetView> {
    return this.assets.confirm(actor, id);
  }

  /** Media library: confirmed assets, newest first, cursor-paginated. */
  @Roles('ADMIN', 'TEACHER')
  @Get('admin/assets')
  list(
    @Query('kind') kind?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const k = (ASSET_KINDS as readonly string[]).includes(kind ?? '')
      ? (kind as (typeof ASSET_KINDS)[number])
      : undefined;
    return this.assets.list({
      kind: k,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Roles('ADMIN', 'TEACHER')
  @Delete('admin/assets/:id')
  @HttpCode(204)
  async remove(
    @CurrentUser() actor: ApiUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.assets.remove(actor, id);
    void this.audit.record(actor, {
      action: 'asset.delete',
      entity: 'Asset',
      entityId: id,
    });
  }

  // ─── Dev disk storage (404 when R2 is configured) ───────────────────────

  /** Target of the dev "presigned" URL; authorised by the HMAC token. */
  @Public()
  @Put('assets/dev-upload/:id')
  @HttpCode(204)
  async devUpload(
    @Param('id') id: string,
    @Query('token') token: string | undefined,
    @Req() req: Request,
  ): Promise<void> {
    const max = await this.assets.devExpectedSize(id);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > max)
        throw new PayloadTooLargeException('Upload exceeds the declared size');
      chunks.push(chunk);
    }
    await this.assets.devUpload(id, token, Buffer.concat(chunks));
  }

  @Public()
  @Get('assets/dev/:id')
  async devServe(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const file = await this.assets.devServe(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(file.data);
  }
}
