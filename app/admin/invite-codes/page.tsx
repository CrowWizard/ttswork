"use client";

import { Suspense } from "react";
import { AdminInviteCodesPage } from "@/components/admin/invite-codes-page";
import { Spin } from "antd";

export default function AdminInviteCodesRoute() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>}>
      <AdminInviteCodesPage />
    </Suspense>
  );
}
