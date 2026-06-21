import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator.js';
import { MultipliersService } from './multipliers.service.js';
import { CreateMultiplierDto, UpdateMultiplierDto } from './multipliers.dto.js';

/** Admin CRUD for Multiplier rows (promotions / premium / streak tiers). */
@Controller('multipliers')
@Roles('ADMIN')
export class MultipliersController {
  constructor(private readonly multipliers: MultipliersService) {}

  @Get()
  list() {
    return this.multipliers.list();
  }

  @Post()
  create(@Body() body: CreateMultiplierDto) {
    return this.multipliers.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateMultiplierDto) {
    return this.multipliers.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.multipliers.remove(id);
  }
}
