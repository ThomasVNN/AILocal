"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { ProxyLogger, RequestLoggerV2, SegmentedControl } from "@/shared/components";

export default function UsagePage() {
  const t = useTranslations("usage");
  const [activeTab, setActiveTab] = useState("logs");

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        options={[
          { value: "logs", label: t("loggerTab") },
          { value: "proxy-logs", label: t("proxyTab") },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "logs" && <RequestLoggerV2 />}
      {activeTab === "proxy-logs" && <ProxyLogger />}
    </div>
  );
}
