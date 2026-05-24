// Stable error response envelope.
//
// Every 4xx/5xx response from the api uses this shape so the web client can
// render structured errors without guessing the field name per endpoint.
import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
