import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

/** Base64url without padding (how browsers serialise the keys). */
const B64URL = /^[A-Za-z0-9_-]+=*$/;

export class WebPushKeysDto {
  /** The browser's P-256 ECDH public key (65 bytes → 87 chars). */
  @IsString()
  @Length(80, 100)
  @Matches(B64URL)
  p256dh!: string;

  /** The 16-byte auth secret (22 chars). */
  @IsString()
  @Length(16, 32)
  @Matches(B64URL)
  auth!: string;
}

/** `PushSubscription.toJSON()` (expirationTime is ignored). */
export class WebPushSubscribeDto {
  @IsString()
  @Length(16, 2048)
  endpoint!: string;

  @ValidateNested()
  @Type(() => WebPushKeysDto)
  keys!: WebPushKeysDto;

  /** Sent by `toJSON()`; not stored (push services expire on their own). */
  @IsOptional()
  @IsNumber()
  expirationTime?: number | null;
}

export class WebPushUnsubscribeDto {
  @IsString()
  @Length(16, 2048)
  endpoint!: string;
}
