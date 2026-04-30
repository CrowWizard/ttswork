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
  Alert,
  Spin,
  Empty,
  InputNumber,
  Typography,
  Drawer,
  Descriptions,
  Grid,
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

type InviteCodeListItem = {
  id: string;
  module: string;
  code: string;
  status: "used" | "unused";
  consumedAt: string | null;
  consumedByUserId: string | null;
  consumedTtsJobId: string | null;
  createdAt: string;
};

type InviteCodesResponse = {
  items: InviteCodeListItem[];
  pagination: AdminPagination;
};

type GenerateResponse = {
  count: number;
  items: Array<{
    id: string;
    code: string;
    createdAt: string;
  }>;
};

type InviteCodeTtsJobsResponse = {
  code: {
    id: string;
    code: string;
    consumedAt: string | null;
    consumedByUserId: string | null;
    user: { id: string; phoneNumber: string } | null;
  };
  ttsJobs: Array<{
    id: string;
    createdAt: string;
    status: string;
    profileKind: string;
    accessKind: string;
    text: string;
    usageCodeValue: string | null;
  }>;
};

export function AdminInviteCodesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const screens = Grid.useBreakpoint();
  const [draftCode, setDraftCode] = useState(searchParams.get("code") ?? "");
  const [draftStatus, setDraftStatus] = useState(searchParams.get("status") ?? "all");
  const [draftDateRange, setDraftDateRange] = useState<[string, string]>([
    searchParams.get("startDate") ?? "",
    searchParams.get("endDate") ?? "",
  ]);
  const [generateCount, setGenerateCount] = useState<number>(10);
  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [listData, setListData] = useState<InviteCodesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ttsDrawerCodeId, setTtsDrawerCodeId] = useState<string | null>(null);
  const [ttsDrawerData, setTtsDrawerData] = useState<InviteCodeTtsJobsResponse | null>(null);
  const [ttsDrawerLoading, setTtsDrawerLoading] = useState(false);
  const [ttsDrawerError, setTtsDrawerError] = useState<string | null>(null);

  useEffect(() => {
    setDraftCode(searchParams.get("code") ?? "");
    setDraftStatus(searchParams.get("status") ?? "all");
    setDraftDateRange([searchParams.get("startDate") ?? "", searchParams.get("endDate") ?? ""]);
  }, [searchParams]);

  const page = readPageParam(searchParams.get("page"));
  const pageSize = readPageSizeParam(searchParams.get("pageSize"));
  const code = readOptionalStringParam(searchParams.get("code"));
  const status = searchParams.get("status") === "used" || searchParams.get("status") === "unused"
    ? searchParams.get("status")
    : "all";
  const startDate = readOptionalStringParam(searchParams.get("startDate"));
  const endDate = readOptionalStringParam(searchParams.get("endDate"));

  useEffect(() => {
    const controller = new AbortController();

    async function loadList() {
      setLoading(true);
      setError(null);
      try {
        const response = await adminFetchJson<InviteCodesResponse>("/api/admin/invite-codes", {
          query: {
            page,
            pageSize,
            code,
            status,
            startAt: toApiStartAt(startDate),
            endAt: toApiEndAt(endDate),
          },
          signal: controller.signal,
        });
        setListData(response);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "邀请码列表加载失败。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadList();
    return () => controller.abort();
  }, [code, endDate, page, pageSize, startDate, status]);

  useEffect(() => {
    if (!ttsDrawerCodeId) {
      setTtsDrawerData(null);
      setTtsDrawerError(null);
      return;
    }

    const controller = new AbortController();

    async function loadTtsJobs() {
      setTtsDrawerLoading(true);
      setTtsDrawerError(null);
      try {
        const response = await adminFetchJson<InviteCodeTtsJobsResponse>(`/api/admin/invite-codes/${ttsDrawerCodeId}/tts-jobs`, {
          signal: controller.signal,
        });
        setTtsDrawerData(response);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setTtsDrawerError(loadError instanceof Error ? loadError.message : "关联语音记录加载失败。");
      } finally {
        if (!controller.signal.aborted) setTtsDrawerLoading(false);
      }
    }

    void loadTtsJobs();
    return () => controller.abort();
  }, [ttsDrawerCodeId]);

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
      code: draftCode.trim() || undefined,
      status: draftStatus !== "all" ? draftStatus : undefined,
      startDate: draftDateRange[0] || undefined,
      endDate: draftDateRange[1] || undefined,
      page: "1",
    });
  }

  function resetFilters() {
    setDraftCode("");
    setDraftStatus("all");
    setDraftDateRange(["", ""]);
    router.replace(pathname);
  }

  async function handleGenerate() {
    if (!generateCount || generateCount <= 0) {
      setError("请输入大于 0 的生成数量。");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const response = await adminFetchJson<GenerateResponse>("/api/admin/invite-codes/generate", {
        method: "POST",
        body: { count: generateCount },
      });
      setGenerated(response);
      const refreshed = await adminFetchJson<InviteCodesResponse>("/api/admin/invite-codes", {
        query: {
          page,
          pageSize,
          code,
          status,
          startAt: toApiStartAt(startDate),
          endAt: toApiEndAt(endDate),
        },
      });
      setListData(refreshed);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "生成邀请码失败。");
    } finally {
      setGenerating(false);
    }
  }

  const columns = [
    {
      title: "Code",
      dataIndex: "code",
      key: "code",
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <Tag color={v === "used" ? "success" : "default"}>{v === "used" ? "已使用" : "未使用"}</Tag>
      ),
    },
    {
      title: "Used By",
      dataIndex: "consumedByUserId",
      key: "user",
      render: (v: string | null) => v ?? "-",
    },
    {
      title: "Used At",
      dataIndex: "consumedAt",
      key: "usedAt",
      render: (v: string | null) => formatAdminDateTime(v),
    },
    {
      title: "Created At",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v: string) => formatAdminDateTime(v),
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, record: InviteCodeListItem) =>
        record.status === "used" ? (
          <Button type="link" size="small" onClick={(e) => { e.stopPropagation(); setTtsDrawerCodeId(record.id); }}>
            查看关联生成
          </Button>
        ) : null,
    },
  ];

  const ttsJobColumns = [
    {
      title: "任务 ID",
      dataIndex: "id",
      key: "id",
      render: (v: string) => <Text copyable style={{ fontSize: 12 }}>{v}</Text>,
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
      title: "类型",
      dataIndex: "profileKind",
      key: "profileKind",
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (v: string) => formatAdminDateTime(v),
    },
    {
      title: "文本",
      dataIndex: "text",
      key: "text",
      ellipsis: true,
    },
  ];

  if (loading && !listData) {
    return (
      <div className="admin-page-full-spinner">
        <Spin size="large" tip="正在加载邀请码库存...">
          <div />
        </Spin>
      </div>
    );
  }

  if (error && !listData) {
    return (
      <Card>
        <Alert role="alert" type="error" message="邀请码列表加载失败" description={error} showIcon />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <Card>
        <Space wrap size={12}>
          <Input
            aria-label="按使用码筛选"
            placeholder="Code"
            value={draftCode}
            onChange={(e) => setDraftCode(e.target.value)}
            style={{ width: 160 }}
          />
          <Select
            aria-label="按使用状态筛选"
            value={draftStatus}
            onChange={setDraftStatus}
            style={{ width: 120 }}
            options={[
              { value: "all", label: "全部" },
              { value: "unused", label: "未使用" },
              { value: "used", label: "已使用" },
            ]}
          />
          <RangePicker
            aria-label="按日期范围筛选"
            onChange={(_, dateStrings) => setDraftDateRange(dateStrings as [string, string])}
          />
          <Button type="primary" onClick={applyFilters}>应用筛选</Button>
          <Button onClick={resetFilters}>重置</Button>
        </Space>
      </Card>

      <Card title="生成使用码" size="small">
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          首版直接返回明文 code，便于运营分发。
        </Paragraph>
        <Space>
          <InputNumber
            aria-label="生成数量"
            min={1}
            max={10000}
            value={generateCount}
            onChange={(v) => setGenerateCount(v ?? 10)}
            style={{ width: 100 }}
          />
          <Button type="primary" onClick={handleGenerate} loading={generating}>
            开始生成
          </Button>
        </Space>
        {generated && (
          <Card
            size="small"
            style={{ marginTop: 16 }}
            title={<Text>本次已生成 {generated.count} 个使用码</Text>}
          >
            <Space wrap>
              {generated.items.map((item) => (
                <Tag key={item.id} color="cyan">{item.code}</Tag>
              ))}
            </Space>
          </Card>
        )}
      </Card>

      {error && <Alert role="alert" type="error" message={error} showIcon />}

      {listData && listData.items.length === 0 ? (
        <Card>
          <Empty description="没有匹配的邀请码，调整筛选条件后重试。" />
        </Card>
      ) : (
        <Card>
          <Table
            dataSource={listData?.items ?? []}
            columns={columns}
            rowKey="id"
            size="small"
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
        title={ttsDrawerData ? `使用码 ${ttsDrawerData.code.code} 的关联语音生成` : "关联语音生成"}
        placement="right"
        width={screens.md ? 640 : "100vw"}
        open={Boolean(ttsDrawerCodeId)}
        onClose={() => setTtsDrawerCodeId(null)}
        loading={ttsDrawerLoading}
      >
        {ttsDrawerError ? (
          <Alert role="alert" type="error" message="加载失败" description={ttsDrawerError} showIcon />
        ) : ttsDrawerData ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="使用码">
                <Text strong>{ttsDrawerData.code.code}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="使用时间">{formatAdminDateTime(ttsDrawerData.code.consumedAt)}</Descriptions.Item>
              <Descriptions.Item label="使用用户">
                {ttsDrawerData.code.user ? (
                  <Text strong>{ttsDrawerData.code.user.phoneNumber}</Text>
                ) : (
                  ttsDrawerData.code.consumedByUserId ?? "-"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="关联语音生成数">{ttsDrawerData.ttsJobs.length}</Descriptions.Item>
            </Descriptions>

            {ttsDrawerData.ttsJobs.length === 0 ? (
              <Empty description="暂无关联的语音生成记录。" />
            ) : (
              <Table
                dataSource={ttsDrawerData.ttsJobs}
                columns={ttsJobColumns}
                rowKey="id"
                size="small"
                pagination={false}
              />
            )}
          </Space>
        ) : null}
      </Drawer>
    </Space>
  );
}
