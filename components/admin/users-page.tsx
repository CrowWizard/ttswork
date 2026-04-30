"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  Table,
  Tag,
  Button,
  Input,
  Space,
  Drawer,
  Descriptions,
  Grid,
  Typography,
  Alert,
  Spin,
  Empty,
} from "antd";
import {
  type AdminPagination,
  adminFetchJson,
  formatAdminDateTime,
  readOptionalStringParam,
  readPageParam,
  readPageSizeParam,
} from "@/lib/admin-api";

const { Text } = Typography;

type UserListItem = {
  id: string;
  phoneNumber: string;
  createdAt: string;
  hasCreatedVoiceprint: boolean;
  hasPureVoiceprint: boolean;
  hasSceneVoiceprint: boolean;
  latestReadyVoiceEnrollmentAt: string | null;
  hasUsedInviteCode: boolean;
  latestInviteCode: string | null;
  latestInviteCodeConsumedAt: string | null;
  voiceGenerationCount: number;
  lastVoiceGeneratedAt: string | null;
  lastActiveAt: string | null;
};

type UserListResponse = {
  items: UserListItem[];
  pagination: AdminPagination;
};

type UserDetailResponse = {
  user: {
    id: string;
    phoneNumber: string;
    phoneVerifiedAt: string | null;
    createdAt: string;
    updatedAt: string;
    activePureVoiceEnrollmentId: string | null;
    activeSceneVoiceEnrollmentId: string | null;
  };
  voiceprint: {
    hasCreatedVoiceprint: boolean;
    latestReadyEnrollmentAt: string | null;
    latestReadyEnrollment: {
      id: string;
      profileKind: string;
      status: string;
      voiceId: string | null;
      isInvalidated: boolean;
      createdAt: string;
    } | null;
    pureEnrollment: {
      id: string;
      profileKind: string;
      status: string;
      voiceId: string | null;
      isInvalidated: boolean;
      createdAt: string;
    } | null;
    sceneEnrollment: {
      id: string;
      profileKind: string;
      status: string;
      voiceId: string | null;
      isInvalidated: boolean;
      createdAt: string;
    } | null;
  };
  inviteCodes: {
    hasUsedInviteCode: boolean;
    totalUsed: number;
    latestCode: string | null;
    items: Array<{
      id: string;
      code: string;
      consumedAt: string | null;
      consumedTtsJobId: string | null;
    }>;
  };
  voiceGenerations: {
    total: number;
    latestGeneratedAt: string | null;
    items: Array<{
      id: string;
      createdAt: string;
      status: string;
      profileKind: string;
      accessKind: string;
      sceneKey: string | null;
      instruction: string | null;
      usageCodeValue: string | null;
    }>;
  };
  analytics: {
    firstSource: {
      anonymousId: string;
      firstSeenAt: string;
      firstLandingPage: string | null;
      firstReferrer: string | null;
      firstUtmSource: string | null;
      firstUtmMedium: string | null;
      firstUtmCampaign: string | null;
    } | null;
    lastActiveAt: string | null;
    linkedAnonymousIds: Array<{
      anonymousId: string;
      firstSeenAt: string;
      lastSeenAt: string;
    }>;
  };
};

export function AdminUsersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const screens = Grid.useBreakpoint();
  const [draftPhoneNumber, setDraftPhoneNumber] = useState(searchParams.get("phoneNumber") ?? "");
  const [draftUserId, setDraftUserId] = useState(searchParams.get("userId") ?? "");
  const [draftInviteCode, setDraftInviteCode] = useState(searchParams.get("inviteCode") ?? "");
  const [draftAnonymousId, setDraftAnonymousId] = useState(searchParams.get("anonymousId") ?? "");
  const [listData, setListData] = useState<UserListResponse | null>(null);
  const [detailData, setDetailData] = useState<UserDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    setDraftPhoneNumber(searchParams.get("phoneNumber") ?? "");
    setDraftUserId(searchParams.get("userId") ?? "");
    setDraftInviteCode(searchParams.get("inviteCode") ?? "");
    setDraftAnonymousId(searchParams.get("anonymousId") ?? "");
  }, [searchParams]);

  const page = readPageParam(searchParams.get("page"));
  const pageSize = readPageSizeParam(searchParams.get("pageSize"));
  const detailId = readOptionalStringParam(searchParams.get("detailId"));
  const userId = readOptionalStringParam(searchParams.get("userId"));
  const phoneNumber = readOptionalStringParam(searchParams.get("phoneNumber"));
  const inviteCode = readOptionalStringParam(searchParams.get("inviteCode"));
  const anonymousId = readOptionalStringParam(searchParams.get("anonymousId"));

  useEffect(() => {
    const controller = new AbortController();

    async function loadList() {
      setLoading(true);
      setError(null);
      try {
        const response = await adminFetchJson<UserListResponse>("/api/admin/users", {
          query: { page, pageSize, userId, phoneNumber, inviteCode, anonymousId },
          signal: controller.signal,
        });
        setListData(response);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "用户列表加载失败。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadList();
    return () => controller.abort();
  }, [anonymousId, inviteCode, page, pageSize, phoneNumber, userId]);

  useEffect(() => {
    if (!detailId) {
      setDetailData(null);
      setDetailError(null);
      return;
    }

    const controller = new AbortController();

    async function loadDetail() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const response = await adminFetchJson<UserDetailResponse>(`/api/admin/users/${detailId}`, {
          signal: controller.signal,
        });
        setDetailData(response);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setDetailError(loadError instanceof Error ? loadError.message : "用户详情加载失败。");
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    }

    void loadDetail();
    return () => controller.abort();
  }, [detailId]);

  function updateQuery(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function applyFilters() {
    updateQuery({
      phoneNumber: draftPhoneNumber.trim() || undefined,
      userId: draftUserId.trim() || undefined,
      inviteCode: draftInviteCode.trim() || undefined,
      anonymousId: draftAnonymousId.trim() || undefined,
      page: "1",
      detailId: undefined,
    });
  }

  function resetFilters() {
    setDraftPhoneNumber("");
    setDraftUserId("");
    setDraftInviteCode("");
    setDraftAnonymousId("");
    router.replace(pathname);
  }

  const columns = [
    {
      title: "手机号",
      dataIndex: "phoneNumber",
      key: "phone",
      render: (v: string, record: UserListItem) => (
        <div>
          <Text strong style={{ fontSize: 15 }}>{v}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>{record.id}</Text>
        </div>
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v: string) => formatAdminDateTime(v),
    },
    {
      title: "纯粹版",
      key: "pureVoice",
      render: (_: unknown, record: UserListItem) => (
        <Tag color={record.hasPureVoiceprint ? "success" : "default"}>
          {record.hasPureVoiceprint ? "已建声" : "未建声"}
        </Tag>
      ),
    },
    {
      title: "场景版",
      key: "sceneVoice",
      render: (_: unknown, record: UserListItem) => (
        <Tag color={record.hasSceneVoiceprint ? "success" : "default"}>
          {record.hasSceneVoiceprint ? "已建声" : "未建声"}
        </Tag>
      ),
    },
    {
      title: "邀请码",
      key: "invite",
      render: (_: unknown, record: UserListItem) => (
        <Tag color={record.hasUsedInviteCode ? "success" : "default"}>
          {record.latestInviteCode ?? "未使用"}
        </Tag>
      ),
    },
    {
      title: "TTS",
      dataIndex: "voiceGenerationCount",
      key: "tts",
      align: "right" as const,
    },
    {
      title: "最近活跃",
      dataIndex: "lastActiveAt",
      key: "activeAt",
      render: (v: string | null) => formatAdminDateTime(v),
    },
  ];

  if (loading && !listData) {
    return (
      <div className="admin-page-full-spinner">
        <Spin size="large" tip="正在加载用户列表...">
          <div />
        </Spin>
      </div>
    );
  }

  if (error && !listData) {
    return (
      <Card>
        <Alert role="alert" type="error" message="用户列表加载失败" description={error} showIcon />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <Card>
        <Space wrap size={12}>
          <Input
            aria-label="按手机号筛选"
            placeholder="手机号"
            value={draftPhoneNumber}
            onChange={(e) => setDraftPhoneNumber(e.target.value)}
            style={{ width: 180 }}
          />
          <Input
            aria-label="按 User ID 筛选"
            placeholder="User ID"
            value={draftUserId}
            onChange={(e) => setDraftUserId(e.target.value)}
            style={{ width: 220 }}
          />
          <Input
            aria-label="按邀请码筛选"
            placeholder="邀请码"
            value={draftInviteCode}
            onChange={(e) => setDraftInviteCode(e.target.value)}
            style={{ width: 140 }}
          />
          <Input
            aria-label="按匿名访客 ID 筛选"
            placeholder="匿名访客 ID"
            value={draftAnonymousId}
            onChange={(e) => setDraftAnonymousId(e.target.value)}
            style={{ width: 220 }}
          />
          <Button type="primary" onClick={applyFilters}>应用筛选</Button>
          <Button onClick={resetFilters}>重置</Button>
        </Space>
      </Card>

      {error && <Alert role="alert" type="error" message={error} showIcon />}

      {listData && listData.items.length === 0 ? (
        <Card>
          <Empty description="没有匹配用户，调整筛选条件后重试。" />
        </Card>
      ) : (
        <Card>
          <Table
            dataSource={listData?.items ?? []}
            columns={columns}
            rowKey="id"
            size="small"
            onRow={(record) => ({
              onClick: () => updateQuery({ detailId: record.id }),
              onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  updateQuery({ detailId: record.id });
                }
              },
              tabIndex: 0,
              style: { cursor: "pointer", background: detailId === record.id ? "var(--admin-row-highlight)" : undefined },
            })}
            pagination={{
              current: listData!.pagination.page,
              pageSize: listData!.pagination.pageSize,
              total: listData!.pagination.total,
              showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
              onChange: (p) => updateQuery({ page: String(p) }),
            }}
          />
        </Card>
      )}

      <Drawer
        title={detailData ? (
          <Space>
            <span>{detailData.user.phoneNumber}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>{detailData.user.id}</Text>
          </Space>
        ) : "用户详情"}
        placement="right"
        width={screens.md ? 480 : "100vw"}
        open={Boolean(detailId)}
        onClose={() => updateQuery({ detailId: undefined })}
        loading={detailLoading}
      >
        {detailError ? (
          <Alert role="alert" type="error" message="用户详情加载失败" description={detailError} showIcon />
        ) : detailData ? (
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Descriptions title="账号信息" column={1} size="small" bordered>
              <Descriptions.Item label="手机号">
                <Text strong style={{ fontSize: 16 }}>{detailData.user.phoneNumber}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="User ID">
                <Text copyable style={{ fontSize: 12 }}>{detailData.user.id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatAdminDateTime(detailData.user.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="最近活跃">{formatAdminDateTime(detailData.analytics.lastActiveAt)}</Descriptions.Item>
            </Descriptions>

            <Card title="声纹状态" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="纯粹版">
                  {detailData.voiceprint.pureEnrollment ? (
                    <Tag color="success">已建声</Tag>
                  ) : (
                    <Tag>未建声</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="场景版">
                  {detailData.voiceprint.sceneEnrollment ? (
                    <Tag color="success">已建声</Tag>
                  ) : (
                    <Tag>未建声</Tag>
                  )}
                </Descriptions.Item>
              </Descriptions>
              {detailData.voiceprint.pureEnrollment && (
                <Descriptions column={1} size="small" title="纯粹版详情" style={{ marginTop: 8 }}>
                  <Descriptions.Item label="Enrollment ID">
                    <Text copyable style={{ fontSize: 12 }}>{detailData.voiceprint.pureEnrollment.id}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">{detailData.voiceprint.pureEnrollment.status}</Descriptions.Item>
                  <Descriptions.Item label="创建时间">{formatAdminDateTime(detailData.voiceprint.pureEnrollment.createdAt)}</Descriptions.Item>
                </Descriptions>
              )}
              {detailData.voiceprint.sceneEnrollment && (
                <Descriptions column={1} size="small" title="场景版详情" style={{ marginTop: 8 }}>
                  <Descriptions.Item label="Enrollment ID">
                    <Text copyable style={{ fontSize: 12 }}>{detailData.voiceprint.sceneEnrollment.id}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">{detailData.voiceprint.sceneEnrollment.status}</Descriptions.Item>
                  <Descriptions.Item label="创建时间">{formatAdminDateTime(detailData.voiceprint.sceneEnrollment.createdAt)}</Descriptions.Item>
                </Descriptions>
              )}
            </Card>

            <Card title="邀请码使用" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="总使用次数">{detailData.inviteCodes.totalUsed}</Descriptions.Item>
                <Descriptions.Item label="最近使用码">{detailData.inviteCodes.latestCode ?? "-"}</Descriptions.Item>
              </Descriptions>
              {detailData.inviteCodes.items.slice(0, 3).map((item) => (
                <Card key={item.id} size="small" style={{ marginTop: 8 }}>
                  <Text strong>{item.code}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>{formatAdminDateTime(item.consumedAt)}</Text>
                </Card>
              ))}
            </Card>

            <Card title="首次来源" size="small">
              {detailData.analytics.firstSource ? (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="首次访问">{formatAdminDateTime(detailData.analytics.firstSource.firstSeenAt)}</Descriptions.Item>
                  <Descriptions.Item label="Landing Page">{detailData.analytics.firstSource.firstLandingPage ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="Referrer">{detailData.analytics.firstSource.firstReferrer ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="UTM Source">{detailData.analytics.firstSource.firstUtmSource ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="UTM Medium">{detailData.analytics.firstSource.firstUtmMedium ?? "-"}</Descriptions.Item>
                  <Descriptions.Item label="UTM Campaign">{detailData.analytics.firstSource.firstUtmCampaign ?? "-"}</Descriptions.Item>
                </Descriptions>
              ) : (
                <Text type="secondary">暂无 analytics 归因记录。</Text>
              )}
            </Card>

            <Card title="最近语音生成" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="总次数">{detailData.voiceGenerations.total}</Descriptions.Item>
                <Descriptions.Item label="最近生成">{formatAdminDateTime(detailData.voiceGenerations.latestGeneratedAt)}</Descriptions.Item>
              </Descriptions>
              {detailData.voiceGenerations.items.slice(0, 3).map((item) => (
                <Card key={item.id} size="small" style={{ marginTop: 8 }}>
                  <Space>
                    <Text strong>{item.id}</Text>
                    <Tag>{item.status}</Tag>
                  </Space>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>{formatAdminDateTime(item.createdAt)}</Text>
                </Card>
              ))}
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
