import {
  transferDetailSchema,
  transferListResponseSchema,
  transferPolicySchema,
  transferPreviewResponseSchema,
  type TransferConfirmationResponse,
  type TransferDetail,
  type TransferListResponse,
  type TransferPolicy,
  type TransferPreviewRequest,
  type TransferPreviewResponse,
} from '@aegis/contracts';
import { request } from './http';

export function createTransferIdempotencyKey(): string {
  return `transfer-${crypto.randomUUID()}`;
}
export const transfersClient = {
  policy(): Promise<TransferPolicy> {
    return request('/api/v1/transfers/policy', transferPolicySchema, {
      method: 'GET',
      unauthenticatedKind: 'session_expired',
    });
  },
  preview(value: TransferPreviewRequest): Promise<TransferPreviewResponse> {
    return request('/api/v1/transfers/preview', transferPreviewResponseSchema, {
      body: value,
      csrf: 'required',
      unauthenticatedKind: 'session_expired',
    });
  },
  confirm(
    intentToken: string,
    pin: string,
    idempotencyKey: string,
  ): Promise<TransferConfirmationResponse> {
    return request('/api/v1/transfers/confirm', transferDetailSchema, {
      body: { intentToken, pin },
      csrf: 'required',
      headers: { 'idempotency-key': idempotencyKey },
      unauthenticatedKind: 'session_expired',
    });
  },
  list(query: URLSearchParams): Promise<TransferListResponse> {
    return request(`/api/v1/transfers?${query}`, transferListResponseSchema, {
      method: 'GET',
      unauthenticatedKind: 'session_expired',
    });
  },
  detail(id: string): Promise<TransferDetail> {
    return request(
      `/api/v1/transfers/${encodeURIComponent(id)}`,
      transferDetailSchema,
      { method: 'GET', unauthenticatedKind: 'session_expired' },
    );
  },
};
