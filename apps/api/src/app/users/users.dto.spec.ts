import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { isValidTimeZone, UpdateMeDto } from './users.dto.js';

const errorsFor = (body: object) =>
  validateSync(plainToInstance(UpdateMeDto, body)).map((e) => e.property);

describe('UpdateMeDto', () => {
  it('accepts real IANA zones and UTC', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(errorsFor({ timezone: 'Asia/Tokyo' })).toEqual([]);
  });

  it('rejects unknown zones', () => {
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(errorsFor({ timezone: 'Not/AZone' })).toEqual(['timezone']);
  });

  it('caps quiet hours at 1439 (minutes of the day)', () => {
    expect(errorsFor({ quietHoursStart: 1439, quietHoursEnd: 0 })).toEqual([]);
    expect(errorsFor({ quietHoursStart: 1440 })).toEqual(['quietHoursStart']);
    expect(errorsFor({ quietHoursEnd: 1440 })).toEqual(['quietHoursEnd']);
  });
});
