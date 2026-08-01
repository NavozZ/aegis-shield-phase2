import 'server-only';

import {
  customerTransactionDetailSchema,
  transactionHistoryResponseSchema,
  type CustomerTransactionDetail,
  type TransactionHistoryResponse,
} from '@aegis/contracts';
import { cookies } from 'next/headers';

type Result<T> =
  | { status: 'ready'; value: T }
  | { status: 'unauthenticated' | 'unavailable' | 'not-found' };

async function gateway<T>(
  path: string,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
): Promise<Result<T>> {
  const cookieName = process.env.AUTH_SESSION_COOKIE_NAME || 'aegis_session';
  const session = (await cookies()).get(cookieName)?.value;
  if (!session) return { status: 'unauthenticated' };
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 5_000);
  try {
    const response = await fetch(
      new URL(
        path,
        process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000',
      ),
      {
        headers: {
          accept: 'application/json',
          cookie: `${encodeURIComponent(cookieName)}=${encodeURIComponent(session)}`,
          'x-correlation-id': crypto.randomUUID(),
        },
        cache: 'no-store',
        signal: abort.signal,
      },
    );
    if (response.status === 401) return { status: 'unauthenticated' };
    if (response.status === 404) return { status: 'not-found' };
    const parsed = schema.safeParse(
      await response.json().catch(() => undefined),
    );
    return response.ok && parsed.success && parsed.data
      ? { status: 'ready', value: parsed.data }
      : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export function getServerTransactions(
  accountId: string,
  query = '',
): Promise<Result<TransactionHistoryResponse>> {
  return gateway(
    `/api/v1/accounts/${encodeURIComponent(accountId)}/transactions${query}`,
    transactionHistoryResponseSchema,
  );
}

export function getServerTransaction(
  accountId: string,
  transactionId: string,
): Promise<Result<CustomerTransactionDetail>> {
  return gateway(
    `/api/v1/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(transactionId)}`,
    customerTransactionDetailSchema,
  );
}
