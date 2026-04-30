"use client";

import { Suspense } from "react";
import { AdminOverviewPage } from "@/components/admin/overview-page";
import { Spin } from "antd";

export default function AdminPage() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>}>
      <AdminOverviewPage />
    </Suspense>
  );
}
