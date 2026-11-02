import { Transform } from 'class-transformer';
import { Equals, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

const emailAtom = String.raw`[\p{L}\p{N}!#$%&'*+/=?^_\x60{|}~-]+`;
const emailLocalPart = `${emailAtom}(?:${String.raw`\.`}${emailAtom})*`;
const emailDomain = String.raw`(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+[\p{L}]{2,63}`;
export const CONTACT_EMAIL_PATTERN = new RegExp(`^${emailLocalPart}@${emailDomain}$`, 'u');

export class CreateContactRequestDto {
  @IsUUID('4')
  chatId: string;

  @Transform(({ value }) => 'string' === typeof value ? value.trim() : value)
  @IsString()
  @Length(2, 100)
  fullName: string;

  @Transform(({ value }) => 'string' === typeof value ? value.trim() : value)
  @IsString()
  @MaxLength(254)
  @Matches(CONTACT_EMAIL_PATTERN)
  email: string;

  @Equals(true)
  consent: boolean;
}
