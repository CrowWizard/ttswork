"use client";

import { Menu } from "antd";
import {
  DashboardOutlined,
  UserOutlined,
  KeyOutlined,
  SoundOutlined,
} from "@ant-design/icons";
import { usePathname } from "next/navigation";
import Link from "next/link";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview", icon: <DashboardOutlined /> },
  { href: "/admin/users", label: "Users", icon: <UserOutlined /> },
  { href: "/admin/invite-codes", label: "Invite Codes", icon: <KeyOutlined /> },
  { href: "/admin/voice-generations", label: "Voice Generations", icon: <SoundOutlined /> },
];

export function AdminNav({ onNavClick }: { onNavClick?: () => void }) {
  const pathname = usePathname();

  return (
    <Menu
      mode="inline"
      selectedKeys={[pathname]}
      style={{ border: "none", background: "transparent" }}
      items={NAV_ITEMS.map((item) => ({
        key: item.href,
        icon: item.icon,
        label: (
          <Link href={item.href} onClick={onNavClick}>
            {item.label}
          </Link>
        ),
      }))}
    />
  );
}
