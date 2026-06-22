import { IsIn, IsString, Length } from 'class-validator';

export const DEVICE_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;

export class RegisterDeviceDto {
  @IsString()
  @Length(1, 4096)
  token!: string;

  @IsIn(DEVICE_PLATFORMS)
  platform!: (typeof DEVICE_PLATFORMS)[number];
}
