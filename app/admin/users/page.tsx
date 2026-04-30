"use client";

import { Suspense } from "react";
import { AdminUsersPage } from "@/components/admin/users-page";
import { Spin } from "antd";

export default function AdminUsersRoute() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>}>
      <AdminUsersPage />
    </Suspense>
  );
}
