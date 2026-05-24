// Zod schema for POST /auth/signup body.
//
// The contract is shared from packages/contracts so the web client and the
// api use the same shape. Re-exporting here keeps the controller import
// surface local to the module.
export { SignupRequestSchema, type SignupRequest } from '@argus/contracts';
