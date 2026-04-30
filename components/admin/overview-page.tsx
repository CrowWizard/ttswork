"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, Table, Button, Segmented, DatePicker, Space, Alert, Spin, Typography } from "antd";
import dayjs from "dayjs";
import {
  adminFetchJson,
  buildPresetRange,
  formatAdminNumber,
  readStringParam,
  toApiEndAt,
  toApiStartAt,
} from "@/lib/admin-api";

const { Text } = Typography;
const { RangePicker } = DatePicker;

type MetricItem = { label: string; value: number };

function MetricValue({ label, value }: MetricItem) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="admin-metric-label">{label}</div>
      <div className="admin-metric-value">{formatAdminNumber(value)}</div>
    </div>
  );
}

function MetricGroup({ label, items }: { label: string; items: MetricItem[] }) {
  return (
    <div className="admin-metric-group">
      <div className="admin-metric-group-label">
        {label}
      </div>
      <div className="admin-metric-values">
        {items.map((item) => (
          <MetricValue key={item.label} label={item.label} value={item.value} />
        ))}
      </div>
    </div>
  );
}

function FunnelGroup({ items }: { items: MetricItem[] }) {
  return (
    <div className="admin-funnel-group">
      <div className="admin-funnel-group-label">
        转化
      </div>
      {items.map((item, i) => (
        <div key={item.label} className="admin-funnel-step">
          {i > 0 && (
            <span className="admin-funnel-arrow">→</span>
          )}
          <MetricValue label={item.label} value={item.value} />
        </div>
      ))}
    </div>
  );
}

type OverviewResponse = {
  metrics: {
    pv: number;
    uv: number;
    sessions: number;
    newUsers: number;
    voiceprintUsers: number;
    voiceGenerations: number;
    voiceGenerationUsers: number;
    inviteCodeUsers: number;
  };
};

type TrendResponse = {
  items: Array<{
    date: string;
    pv: number;
    uv: number;
    sessions: number;
    newUsers: number;
    voiceprintUsers: number;
    voiceGenerations: number;
    inviteCodeUsers: number;
  }>;
};

type ChannelsResponse = {
  items: Array<{
    channel: string;
    sessions: number;
    uv: number;
    pv: number;
    voiceGenerations: number;
  }>;
};

function channelLabel(channel: string) {
  return channel.replaceAll("_", " ");
}

export function AdminOverviewPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [trend, setTrend] = useState<TrendResponse | null>(null);
  const [channels, setChannels] = useState<ChannelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const preset = searchParams.get("range") === "30d" || searchParams.get("range") === "custom"
    ? (searchParams.get("range") as "30d" | "custom")
    : "7d";

  const [customStartDate, setCustomStartDate] = useState(readStringParam(searchParams.get("startDate")));
  const [customEndDate, setCustomEndDate] = useState(readStringParam(searchParams.get("endDate")));

  useEffect(() => {
    setCustomStartDate(readStringParam(searchParams.get("startDate")));
    setCustomEndDate(readStringParam(searchParams.get("endDate")));
  }, [searchParams]);

  const resolvedDates = useMemo(() => {
    if (preset === "custom") {
      return { startDate: customStartDate, endDate: customEndDate };
    }
    return buildPresetRange(preset);
  }, [customEndDate, customStartDate, preset]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = {
          startAt: toApiStartAt(resolvedDates.startDate),
          endAt: toApiEndAt(resolvedDates.endDate),
        };
        const [overviewData, trendData, channelData] = await Promise.all([
          adminFetchJson<OverviewResponse>("/api/admin/analytics/overview", { query, signal: controller.signal }),
          adminFetchJson<TrendResponse>("/api/admin/analytics/trend", { query, signal: controller.signal }),
          adminFetchJson<ChannelsResponse>("/api/admin/analytics/channels", { query, signal: controller.signal }),
        ]);
        setOverview(overviewData);
        setTrend(trendData);
        setChannels(channelData);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "概览数据加载失败。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [resolvedDates.endDate, resolvedDates.startDate]);

  function updateQuery(next: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const m = overview?.metrics;

  const trafficItems = m
    ? [
        { label: "页面访问量", value: m.pv },
        { label: "访客数", value: m.uv },
        { label: "会话数", value: m.sessions },
      ]
    : [];

  const funnelItems = m
    ? [
        { label: "新注册", value: m.newUsers },
        { label: "已建声", value: m.voiceprintUsers },
        { label: "已生成", value: m.voiceGenerationUsers },
        { label: "已用码", value: m.inviteCodeUsers },
      ]
    : [];

  const outputItems = m ? [{ label: "语音生成", value: m.voiceGenerations }] : [];

  const trendColumns = [
    { title: "日期", dataIndex: "date", key: "date", width: 120 },
    { title: "PV", dataIndex: "pv", key: "pv", render: (v: number) => formatAdminNumber(v) },
    { title: "UV", dataIndex: "uv", key: "uv", render: (v: number) => formatAdminNumber(v) },
    { title: "Sessions", dataIndex: "sessions", key: "sessions", render: (v: number) => formatAdminNumber(v) },
    { title: "TTS", dataIndex: "voiceGenerations", key: "voiceGenerations", render: (v: number) => formatAdminNumber(v) },
  ];

  const channelColumns = [
    { title: "Channel", dataIndex: "channel", key: "channel", render: (ch: string) => channelLabel(ch) },
    { title: "PV", dataIndex: "pv", key: "pv", render: (v: number) => formatAdminNumber(v) },
    { title: "UV", dataIndex: "uv", key: "uv", render: (v: number) => formatAdminNumber(v) },
    { title: "Sessions", dataIndex: "sessions", key: "sessions", render: (v: number) => formatAdminNumber(v) },
    { title: "Voice Generations", dataIndex: "voiceGenerations", key: "voiceGenerations", render: (v: number) => formatAdminNumber(v) },
  ];

  if (loading && !overview) {
    return (
      <div className="admin-page-full-spinner">
        <Spin size="large" tip="正在加载运营概览...">
          <div />
        </Spin>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <Card>
        <Alert
          role="alert"
          type="error"
          message="概览加载失败"
          description={error}
          showIcon
          action={
            <Button size="small" onClick={() => router.refresh()}>
              重新加载
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <div className="admin-range-bar">
        <Segmented
          aria-label="选择时间范围"
          value={preset}
          options={[
            { label: "7d", value: "7d" },
            { label: "30d", value: "30d" },
            { label: "自定义", value: "custom" },
          ]}
          onChange={(value) => {
            const nextPreset = value as "7d" | "30d" | "custom";
            if (nextPreset !== "custom") {
              updateQuery({ range: nextPreset, startDate: undefined, endDate: undefined });
            } else {
              updateQuery({ range: "custom", startDate: customStartDate || undefined, endDate: customEndDate || undefined });
            }
          }}
        />
        {preset === "custom" && (
          <>
            <RangePicker
              aria-label="自定义日期范围"
              value={[
                customStartDate ? dayjs(customStartDate) : null,
                customEndDate ? dayjs(customEndDate) : null,
              ]}
              onChange={(_, dateStrings) => {
                setCustomStartDate(dateStrings[0]);
                setCustomEndDate(dateStrings[1]);
              }}
            />
            <Button
              type="primary"
              onClick={() =>
                updateQuery({ range: "custom", startDate: customStartDate || undefined, endDate: customEndDate || undefined })
              }
            >
              应用范围
            </Button>
          </>
        )}
      </div>

      {error && <Alert role="alert" type="error" message={error} showIcon />}

      {m && (
        <section
          aria-label="核心指标"
          className="admin-metrics-strip"
        >
          <MetricGroup label="流量" items={trafficItems} />
          <FunnelGroup items={funnelItems} />
          <MetricGroup label="产出" items={outputItems} />
        </section>
      )}

      <Card>
        <div className="admin-section-heading">
          <Text strong className="admin-section-title">按天趋势</Text>
          <Text type="secondary" className="admin-section-subtitle">PV, UV, Sessions, TTS</Text>
        </div>
        <Table
          dataSource={trend?.items ?? []}
          columns={trendColumns}
          rowKey="date"
          size="small"
          pagination={false}
        />
      </Card>

      <Card>
        <div className="admin-section-heading">
          <Text strong className="admin-section-title">渠道分布</Text>
          <Text type="secondary" className="admin-section-subtitle">按会话归因</Text>
        </div>
        <Table
          dataSource={channels?.items ?? []}
          columns={channelColumns}
          rowKey="channel"
          size="small"
          pagination={false}
        />
      </Card>
    </Space>
  );
}
