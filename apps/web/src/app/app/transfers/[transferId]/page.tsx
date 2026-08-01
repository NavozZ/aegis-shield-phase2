import { TransferRecord } from '@/components/transfers/transfer-record';
export default async function TransferPage({
  params,
}: {
  params: Promise<{ transferId: string }>;
}) {
  const { transferId } = await params;
  return <TransferRecord id={transferId} />;
}
