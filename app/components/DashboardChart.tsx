import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";

interface ChartDataItem {
    name: string;
    value: number;
    fill: string;
}

interface DashboardChartProps {
    chartData: ChartDataItem[];
    type?: "donut" | "bar";
    height?: number;
    label?: string;
}

const CUSTOM_TOOLTIP_STYLE: React.CSSProperties = {
    background: "rgba(26, 26, 26, 0.92)",
    border: "none",
    borderRadius: "8px",
    padding: "8px 14px",
    color: "#fff",
    fontSize: "13px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
};

const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0];
    return (
        <div style={CUSTOM_TOOLTIP_STYLE}>
            <span style={{ color: d.payload.fill || d.color, fontWeight: 600 }}>{d.payload.name || d.name}</span>
            <span style={{ marginLeft: 8 }}>{d.value?.toLocaleString()}</span>
        </div>
    );
};

export default function DashboardChart({ chartData, type = "donut", height }: DashboardChartProps) {
    if (chartData.length === 0) {
        return (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--p-color-text-subdued)", fontSize: 14 }}>
                No data to display yet.
            </div>
        );
    }

    if (type === "bar") {
        return (
            <ResponsiveContainer width="100%" height={height ?? 260}>
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 4 }} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
                    <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: "#6b7280" }}
                        axisLine={{ stroke: "rgba(0,0,0,0.08)" }}
                        tickLine={false}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={52}
                    />
                    <YAxis
                        tick={{ fontSize: 11, fill: "#6b7280" }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={40}>
                        {chartData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        );
    }

    // Donut chart
    return (
        <ResponsiveContainer width="100%" height={height ?? 240}>
            <PieChart>
                <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                >
                    {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                    ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => <span style={{ fontSize: 12, color: "#6b7280" }}>{value}</span>}
                />
            </PieChart>
        </ResponsiveContainer>
    );
}
