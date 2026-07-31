import {
  accountBalanceSchema,
  customerAccountDetailSchema,
  customerAccountListSchema,
  type AccountBalance,
  type CustomerAccountDetail,
  type CustomerAccountList,
} from '@aegis/contracts';
import { request } from './http';

/**
 * Generates a fresh idempotency key for one provisioning attempt. A retry of
 * the same attempt reuses the key, so the Ledger returns the original account
 * instead of creating a second one.
 */
export function createIdempotencyKey(): string {
  return `acct-default-${crypto.randomUUID()}`;
}

export const accountsClient = {
  list(): Promise<CustomerAccountList> {
    return request('/api/v1/accounts', customerAccountListSchema, {
      method: 'GET',
      unauthenticatedKind: 'session_expired',
    });
  },
  provisionDefault(idempotencyKey: string): Promise<CustomerAccountDetail> {
    return request('/api/v1/accounts/default', customerAccountDetailSchema, {
      body: {},
      csrf: 'required',
      headers: { 'idempotency-key': idempotencyKey },
      unauthenticatedKind: 'session_expired',
    });
  },
  detail(accountId: string): Promise<CustomerAccountDetail> {
    return request(
      `/api/v1/accounts/${encodeURIComponent(accountId)}`,
      customerAccountDetailSchema,
      { method: 'GET', unauthenticatedKind: 'session_expired' },
    );
  },
  balance(accountId: string): Promise<AccountBalance> {
    return request(
      `/api/v1/accounts/${encodeURIComponent(accountId)}/balance`,
      accountBalanceSchema,
      { method: 'GET', unauthenticatedKind: 'session_expired' },
    );
  },
};
