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
  Select,
  DatePicker,
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
  toApiEndAt,
  toApiStartAt,
} from "@/lib/admin-api";

const { Text, Paragraph } = Typography;
const { RangePicker } = DatePicker;

type VoiceGenerationListItem = {
  id: string;
  userId: string | null;
  userPhoneNumber: string | null;
  anonymousUserId: string | null;
  voiceEnrollmentId: string | null;
  createdAt: string;
  status: string;
  profileKind: string;
  accessKind: string;
  usageCodeValue: string | null;
  sceneKey: string | null;
  instruction: string | null;
  voiceEnrollment: {
    id: string;
    status: string;
    voiceId: string | null;
    isInvalidated: boolean;
    profileKind: string;
  } | null;
};

type VoiceGenerationListResponse = {
  items: VoiceGenerationListItem[];
  pagination: AdminPagination;
};

type VoiceGenerationDetailResponse = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  profileKind: string;
  accessKind: string;
  usageCodeId: string | null;
  usageCodeValue: string | null;
  usageCode: {
    id: string;
    code: string;
    consumedAt: string | null;
    consumedByUserId: string | null;
  } | null;
  text: string;
  sceneKey: string | null;
  instruction: string | null;
  voiceIdSnapshot: string;
  outputContentType: string | null;
  errorMessage: string | null;
  bucket: string | null;
  objectKey: string | null;
  minioUri: string | null;
  user: {
    id: string;
    phoneNumber: string;
    createdAt: string;
  } | null;
  anonymousUser: {
    id: string;
    createdAt: string;
    lastSeenAt: string;
  } | null;
  voiceEnrollment: {
    id: string;
    profileKind: string;
    status: string;
    voiceId: string | null;
    isInvalidated: boolean;
    createdAt: string;
  } | null;
};

function booleanFilterValue(raw: string | null) {
  if (raw === "true" || raw === "false") return raw;
  return "all";
}

export function AdminVoiceGenerationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const screens = Grid.useBreakpoint();
  const [draftStartDate, setDraftStartDate] = useState(searchParams.get("startDate") ?? "");
  const [draftEndDate, setDraftEndDate] = useState(searchParams.get("endDate") ?? "");
  const [draftPhoneNumber, setDraftPhoneNumber] = useState(searchParams.get("phoneNumber") ?? "");
  const [draftUserId, setDraftUserId] = useState(searchParams.get("userId") ?? "");
  const [draftStatus, setDraftStatus] = useState(searchParams.get("status") ?? "all");
  const [draftHasUsageCode, setDraftHasUsageCode] = useState(booleanFilterValue(searchParams.get("hasUsageCode")));
  const [listData, setListData] = useState<VoiceGenerationListResponse | null>(null);
  const [detailData, setDetailData] = useState<VoiceGenerationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    setDraftStartDate(searchParams.get("startDate") ?? "");
    setDraftEndDate(searchParams.get("endDate") ?? "");
    setDraftPhoneNumber(searchParams.get("phoneNumber") ?? "");
    setDraftUserId(searchParams.get("userId") ?? "");
    setDraftStatus(searchParams.get("status") ?? "all");
    setDraftHasUsageCode(booleanFilterValue(searchParams.get("hasUsageCode")));
  }, [searchParams]);

  const page = readPageParam(searchParams.get("page"));
  const pageSize = readPageSizeParam(searchParams.get("pageSize"));
  const detailId = readOptionalStringParam(searchParams.get("detailId"));
  const startDate = readOptionalStringParam(searchParams.get("startDate"));
  const endDate = readOptionalStringParam(searchParams.get("endDate"));
  const userId = readOptionalStringParam(searchParams.get("userId"));
  const phoneNumber = readOptionalStringParam(searchParams.get("phoneNumber"));
  const status =
    searchParams.get("status") === "PENDING" || searchParams.get("status") === "READY" || searchParams.get("status") === "FAILED"
      ? searchParams.get("status")
      : undefined;
  const hasUsageCode =
    searchParams.get("hasUsageCode") === "true"
      ? true
      : searchParams.get("hasUsageCode") === "false"
        ? false
        : undefined;

  useEffect(() => {
    const controller = new AbortController();

    async function loadList() {
      setLoading(true);
      setError(null);
      try {
        const response = await adminFetchJson<VoiceGenerationListResponse>("/api/admin/voice-generations", {
          query: {
            page,
            pageSize,
            startAt: toApiStartAt(startDate),
            endAt: toApiEndAt(endDate),
            userId,
            phoneNumber,
            status,
            hasUsageCode,
          },
          signal: controller.signal,
        });
        setListData(response);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "语音生成列表加载失败。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadList();
    return () => controller.abort();
  }, [endDate, hasUsageCode, page, pageSize, startDate, status, userId, phoneNumber]);

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
        const response = await adminFetchJson<VoiceGenerationDetailResponse>(`/api/admin/voice-generations/${detailId}`, {
          signal: controller.signal,
        });
        setDetailData(response);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setDetailError(loadError instanceof Error ? loadError.message : "语音生成详情加载失败。");
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
      startDate: draftStartDate || undefined,
      endDate: draftEndDate || undefined,
      phoneNumber: draftPhoneNumber.trim() || undefined,
      userId: draftUserId.trim() || undefined,
      status: draftStatus !== "all" ? draftStatus : undefined,
      hasUsageCode: draftHasUsageCode !== "all" ? draftHasUsageCode : undefined,
      page: "1",
      detailId: undefined,
    });
  }

  function resetFilters() {
    setDraftStartDate("");
    setDraftEndDate("");
    setDraftPhoneNumber("");
    setDraftUserId("");
    setDraftStatus("all");
    setDraftHasUsageCode("all");
    router.replace(pathname);
  }

  const columns = [
    {
      title: "任务",
      dataIndex: "id",
      key: "id",
      render: (_: string, record: VoiceGenerationListItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.id}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.createdAt}</Text>
        </div>
      ),
    },
    {
      title: "用户",
      key: "user",
      render: (_: unknown, record: VoiceGenerationListItem) =>
        record.userId ? (
          <div>
            <Text strong>{record.userPhoneNumber ?? "-"}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>{record.userId}</Text>
          </div>
        ) : (
          <Text type="secondary">匿名 {record.anonymousUserId ?? "-"}</Text>
        ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => {
        const color = v === "READY" ? "success" : v === "FAILED" ? "error" : "processing";
        return <Tag color={color}>{v}</Tag>;
      },
    },
    {
      title: "声纹",
      key: "profile",
      render: (_: unknown, record: VoiceGenerationListItem) => (
        <div>
          <div>{record.profileKind}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.voiceEnrollment ? record.voiceEnrollment.status : "无关联"}
          </Text>
        </div>
      ),
    },
    {
      title: "权益",
      key: "access",
      render: (_: unknown, record: VoiceGenerationListItem) => (
        <div>
          <div>{record.accessKind}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.usageCodeValue ?? "无邀请码"}</Text>
        </div>
      ),
    },
  ];

  if (loading && !listData) {
    return (
      <div className="admin-page-full-spinner">
        <Spin size="large" tip="正在加载语音生成记录...">
          <div />
        </Spin>
      </div>
    );
  }

  if (error && !listData) {
    return (
      <Card>
        <Alert role="alert" type="error" message="语音生成列表加载失败" description={error} showIcon />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <Card>
        <Space wrap size={12}>
          <RangePicker
            aria-label="按日期范围筛选"
            onChange={(_, dateStrings) => {
              setDraftStartDate(dateStrings[0]);
              setDraftEndDate(dateStrings[1]);
            }}
          />
          <Input
            aria-label="按手机号筛选"
            placeholder="手机号"
            value={draftPhoneNumber}
            onChange={(e) => setDraftPhoneNumber(e.target.value)}
            style={{ width: 160 }}
          />
          <Input
            aria-label="按 User ID 筛选"
            placeholder="User ID"
            value={draftUserId}
            onChange={(e) => setDraftUserId(e.target.value)}
            style={{ width: 220 }}
          />
          <Select
            aria-label="按任务状态筛选"
            value={draftStatus}
            onChange={setDraftStatus}
            style={{ width: 120 }}
            options={[
              { value: "all", label: "全部状态" },
              { value: "PENDING", label: "PENDING" },
              { value: "READY", label: "READY" },
              { value: "FAILED", label: "FAILED" },
            ]}
          />
          <Select
            aria-label="按使用码使用情况筛选"
            value={draftHasUsageCode}
            onChange={setDraftHasUsageCode}
            style={{ width: 120 }}
            options={[
              { value: "all", label: "全部" },
              { value: "true", label: "已使用" },
              { value: "false", label: "未使用" },
            ]}
          />
          <Button type="primary" onClick={applyFilters}>应用筛选</Button>
          <Button onClick={resetFilters}>重置</Button>
        </Space>
      </Card>

      {error && <Alert role="alert" type="error" message={error} showIcon />}

      {listData && listData.items.length === 0 ? (
        <Card>
          <Empty description="没有匹配的语音生成记录，调整筛选条件后重试。" />
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
        title={detailData ? `任务 ${detailData.id}` : "任务详情"}
        placement="right"
        width={screens.md ? 480 : "100vw"}
        open={Boolean(detailId)}
        onClose={() => updateQuery({ detailId: undefined })}
        loading={detailLoading}
      >
        {detailError ? (
          <Alert role="alert" type="error" message="任务详情加载失败" description={detailError} showIcon />
        ) : detailData ? (
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Descriptions title="Task" column={1} size="small" bordered>
              <Descriptions.Item label="创建时间">{formatAdminDateTime(detailData.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={detailData.status === "READY" ? "success" : detailData.status === "FAILED" ? "error" : "processing"}>
                  {detailData.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Profile Kind">{detailData.profileKind}</Descriptions.Item>
              <Descriptions.Item label="Access Kind">{detailData.accessKind}</Descriptions.Item>
            </Descriptions>

            <Card title="文本摘要" size="small">
              <Paragraph style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: 0 }}>
                {detailData.text}
              </Paragraph>
            </Card>

            <Card title="场景与声纹" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Scene Key">{detailData.sceneKey ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="Instruction">{detailData.instruction ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="Voice Snapshot">{detailData.voiceIdSnapshot}</Descriptions.Item>
                <Descriptions.Item label="Voice Enrollment">{detailData.voiceEnrollment?.id ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="Enrollment Status">{detailData.voiceEnrollment?.status ?? "-"}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="邀请码与用户" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="邀请码">{detailData.usageCodeValue ?? detailData.usageCode?.code ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="使用时间">{formatAdminDateTime(detailData.usageCode?.consumedAt)}</Descriptions.Item>
                <Descriptions.Item label="手机号">
                  {detailData.user ? <Text strong>{detailData.user.phoneNumber}</Text> : "-"}
                </Descriptions.Item>
                <Descriptions.Item label="User ID">
                  <Text copyable style={{ fontSize: 12 }}>{detailData.user?.id ?? "-"}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Anonymous ID">{detailData.anonymousUser?.id ?? "-"}</Descriptions.Item>
              </Descriptions>
            </Card>

            <Card title="输出信息" size="small">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Content Type">{detailData.outputContentType ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="Bucket">{detailData.bucket ?? "-"}</Descriptions.Item>
                <Descriptions.Item label="Object Key">
                  <Text copyable style={{ wordBreak: "break-all" }}>{detailData.objectKey ?? "-"}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="MinIO URI">
                  <Text copyable style={{ wordBreak: "break-all" }}>{detailData.minioUri ?? "-"}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Error">{detailData.errorMessage ?? "-"}</Descriptions.Item>
              </Descriptions>
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
