import { AccountOrderPage } from "@/components/account-ui";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AccountOrderPage id={id} />;
}
