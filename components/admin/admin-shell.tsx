"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ConfigProvider, Layout, theme, Typography, Space, Button, Modal, Form, Input, Badge, Flex, Grid, Drawer as AntDrawer } from "antd";
import { LockOutlined, UserOutlined, SafetyCertificateOutlined, MenuOutlined } from "@ant-design/icons";
import {
  ADMIN_AUTH_REQUIRED_EVENT,
  ADMIN_AUTH_UPDATED_EVENT,
  AdminApiError,
  clearAdminCredentials,
  getStoredAdminCredentials,
  saveAdminCredentials,
  verifyAdminCredentials,
} from "@/lib/admin-api";
import { AdminNav } from "./admin-nav";

const { Sider, Content, Header } = Layout;
const { Title, Text, Paragraph } = Typography;

const PAGE_META: Record<string, { title: string; description: string }> = {
  "/admin": {
    title: "Overview",
    description: "运营概览、趋势与渠道分布。",
  },
  "/admin/users": {
    title: "Users",
    description: "按用户、邀请码与匿名访客线索回查注册账号。",
  },
  "/admin/invite-codes": {
    title: "Invite Codes",
    description: "查看库存状态并生成新的使用码。",
  },
  "/admin/voice-generations": {
    title: "Voice Generations",
    description: "筛选语音生成记录并查看任务详情。",
  },
};

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const pageMeta = useMemo(() => PAGE_META[pathname] ?? PAGE_META["/admin"], [pathname]);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [form] = Form.useForm();

  useEffect(() => {
    const syncCredentials = () => {
      setHasCredentials(Boolean(getStoredAdminCredentials()));
    };

    const handleAuthRequired = () => {
      setHasCredentials(Boolean(getStoredAdminCredentials()));
      setIsAuthModalOpen(true);
    };

    syncCredentials();
    window.addEventListener(ADMIN_AUTH_UPDATED_EVENT, syncCredentials);
    window.addEventListener(ADMIN_AUTH_REQUIRED_EVENT, handleAuthRequired);

    return () => {
      window.removeEventListener(ADMIN_AUTH_UPDATED_EVENT, syncCredentials);
      window.removeEventListener(ADMIN_AUTH_REQUIRED_EVENT, handleAuthRequired);
    };
  }, []);

  function handleNavClick() {
    setMobileDrawerOpen(false);
  }

  async function handleSubmit() {
    try {
      const values = await form.validateFields();
      const normalizedUsername = values.username.trim();

      if (!normalizedUsername || !values.password) {
        setAuthError("请输入管理员用户名和密码。");
        return;
      }

      setAuthError(null);

      await verifyAdminCredentials({
        username: normalizedUsername,
        password: values.password,
      });
      saveAdminCredentials({
        username: normalizedUsername,
        password: values.password,
      });
      setHasCredentials(true);
      setIsAuthModalOpen(false);
      form.resetFields();
    } catch (error) {
      if (error instanceof AdminApiError) {
        setAuthError(error.message);
      } else if (error instanceof Error && error.message !== "Validation failed") {
        setAuthError("管理员认证失败，请稍后重试。");
      }
    }
  }

  function handleClearCredentials() {
    clearAdminCredentials();
    setHasCredentials(false);
    form.resetFields();
    setAuthError(null);
  }

  const siderInner = (
    <Flex vertical gap={24} className="admin-sider-inner">
      <div>
        <Badge
          count="Product Register"
          className="admin-badge-register"
        />
        <Title level={4} className="admin-header-title" style={{ marginTop: 12 }}>
          Admin Console
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
          独立深色控制台，仅承载最小可用运营查询。
        </Paragraph>
      </div>

      <AdminNav onNavClick={handleNavClick} />

      <div style={{ marginTop: "auto" }}>
        <div className="admin-connection-panel">
          <Flex justify="space-between" align="center">
            <div>
              <Text type="secondary" className="admin-connection-label">
                Connection
              </Text>
              <div style={{ marginTop: 4 }}>
                <Text className="admin-connection-text">/api/admin/* 客户端拉取</Text>
              </div>
            </div>
            <Badge status={hasCredentials ? "success" : "warning"} text={hasCredentials ? "已认证" : "待认证"} />
          </Flex>
          <Button
            block
            style={{ marginTop: 12 }}
            onClick={() => setIsAuthModalOpen(true)}
            icon={<SafetyCertificateOutlined />}
          >
            {hasCredentials ? "更新管理员凭证" : "输入管理员凭证"}
          </Button>
        </div>
      </div>
    </Flex>
  );

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "var(--admin-accent)",
          borderRadius: 8,
          colorBgContainer: "var(--admin-container-bg)",
          colorBgElevated: "var(--admin-elevated-bg)",
          colorBgLayout: "var(--admin-layout-bg)",
        },
      }}
    >
      <Layout style={{ minHeight: "100vh" }}>
        <Sider
          width={280}
          style={{
            borderRight: "1px solid var(--admin-border)",
            background: "var(--admin-sider-bg)",
          }}
          breakpoint="lg"
          collapsedWidth={0}
          collapsed={siderCollapsed}
          onBreakpoint={(broken) => setSiderCollapsed(broken)}
          trigger={null}
        >
          {siderInner}
        </Sider>

        <AntDrawer
          placement="left"
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          styles={{
            header: { display: "none" },
            body: { padding: 0, background: "var(--admin-sider-bg)" },
          }}
          width={280}
        >
          {siderInner}
        </AntDrawer>

        <Layout>
          <Header className="admin-header">
            <div className="admin-header-title-group">
              {siderCollapsed && (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={() => setMobileDrawerOpen(true)}
                  className="admin-header-menu-btn"
                  aria-label="打开导航菜单"
                />
              )}
              <div style={{ minWidth: 0 }}>
                <Text className="admin-header-label">
                  {pageMeta.title}
                </Text>
                <Title level={isMobile ? 5 : 3} className="admin-header-title">
                  {pageMeta.title}
                </Title>
                {!isMobile && (
                  <Paragraph type="secondary" style={{ marginBottom: 0, maxWidth: 600 }}>
                    {pageMeta.description}
                  </Paragraph>
                )}
              </div>
            </div>
            <Space size={8} wrap>
              {!isMobile && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Basic Auth 仅作用于当前标签页会话
                </Text>
              )}
              <Button
                size="small"
                onClick={() => setIsAuthModalOpen(true)}
                icon={<LockOutlined />}
              >
                {hasCredentials ? "管理认证" : "管理员认证"}
              </Button>
            </Space>
          </Header>

          <Content style={{ padding: isMobile ? "16px" : "24px", overflow: "auto" }}>{children}</Content>
        </Layout>
      </Layout>

      <Modal
        title="管理员认证"
        open={isAuthModalOpen}
        onCancel={() => setIsAuthModalOpen(false)}
        onOk={handleSubmit}
        okText="保存并校验"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="管理员账号" rules={[{ required: true, message: "请输入管理员账号" }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" placeholder="username" />
          </Form.Item>
          <Form.Item name="password" label="管理员密码" rules={[{ required: true, message: "请输入管理员密码" }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder="password" />
          </Form.Item>
        </Form>

        {hasCredentials && (
          <Button danger block onClick={handleClearCredentials} style={{ marginBottom: 16 }}>
            清除已保存凭证
          </Button>
        )}

        {authError && (
          <div className="admin-auth-error">{authError}</div>
        )}

        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
          首次进入或收到 401 提示时，在此输入 ADMIN_USERNAME 与 ADMIN_PASSWORD 对应凭证。
          页面不会展示明文账号，仅在当前标签页暂存 Basic Auth 信息。
        </Paragraph>
      </Modal>
    </ConfigProvider>
  );
}
