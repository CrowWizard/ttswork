"use client";

import { Suspense } from "react";
import { AdminVoiceGenerationsPage } from "@/components/admin/voice-generations-page";
import { Spin } from "antd";

export default function AdminVoiceGenerationsRoute() {
  return (
    <Suspense fallback={<div style={{ textAlign: "center", padding: 80 }}><Spin size="large" /></div>}>
      <AdminVoiceGenerationsPage />
    </Suspense>
  );
}
