import { z } from 'zod';

export const NonEmptyStringSchema = z.string().trim().min(1);
export const UnknownRecordSchema = z.object({}).catchall(z.unknown());
