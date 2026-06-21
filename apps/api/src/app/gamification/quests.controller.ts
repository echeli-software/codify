import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { ApiUser } from '../auth/auth.types.js';
import { QuestsService, type QuestView } from './quests.service.js';
import { CreateQuestTemplateDto, UpdateQuestTemplateDto } from './quests.dto.js';

/**
 * Daily quests for students + quest-template management for admins.
 *   GET  /api/quests/today        — STUDENT: today's 3 quests (lazy-assigned)
 *   GET  /api/quest-templates     — ADMIN: list templates
 *   POST/PATCH/DELETE /quest-templates — ADMIN: manage templates
 */
@Controller()
export class QuestsController {
  constructor(private readonly quests: QuestsService) {}

  @Roles('STUDENT')
  @Get('quests/today')
  today(@CurrentUser() actor: ApiUser): Promise<QuestView[]> {
    return this.quests.listToday(actor.userId);
  }

  @Roles('ADMIN')
  @Get('quest-templates')
  list(@Query('includeInactive') includeInactive?: string) {
    return this.quests.listTemplates(includeInactive === 'true');
  }

  @Roles('ADMIN')
  @Post('quest-templates')
  create(@Body() body: CreateQuestTemplateDto) {
    return this.quests.createTemplate(body);
  }

  @Roles('ADMIN')
  @Patch('quest-templates/:id')
  update(@Param('id') id: string, @Body() body: UpdateQuestTemplateDto) {
    return this.quests.updateTemplate(id, body);
  }

  @Roles('ADMIN')
  @Delete('quest-templates/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.quests.deleteTemplate(id);
  }
}
