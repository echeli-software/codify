import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Codes are letters, digits, `-` and `_`; stored upper-case. */
export const PROMO_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
/** docs/07 §12: coin grants above 1000 are admin-only — codes stay below 10k. */
export const MAX_PROMO_COINS = 10_000;

export class CreatePromoCodeDto {
  @IsString()
  @Matches(PROMO_CODE_PATTERN, {
    message: 'code must be 3–32 letters, digits, "-" or "_"',
  })
  code!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_PROMO_COINS)
  coins!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxRedemptions?: number | null;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  description?: string | null;
}

export class UpdatePromoCodeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PROMO_COINS)
  coins?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxRedemptions?: number | null;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  description?: string | null;
}

export class RedeemPromoCodeDto {
  @IsString()
  @Length(1, 64)
  code!: string;
}

export interface PromoCodeView {
  id: string;
  code: string;
  coins: number;
  maxRedemptions: number | null;
  redemptions: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  description: string | null;
  /** Active, inside its window and not exhausted right now. */
  redeemableNow: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RedeemPromoCodeResponse {
  code: string;
  coins: number;
  totals: { totalXp: number; coins: number; level: number };
}
