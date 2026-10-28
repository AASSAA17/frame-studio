import { ClientDetailPage } from "@/components/client-management";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientDetailPage id={id} />;
}
