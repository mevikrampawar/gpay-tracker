import { useId } from "react"

export function Sparkline({
  data,
  width = 96,
  height = 28,
  className,
  stroke = "var(--chart-1)",
  fillOpacity = 0.18,
}: {
  data: number[]
  width?: number
  height?: number
  className?: string
  stroke?: string
  fillOpacity?: number
}) {
  const gid = useId().replace(/[:]/g, "")
  if (!data.length) return <div className={className} style={{ width, height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = 2
  const step = (width - pad * 2) / Math.max(1, data.length - 1)
  const pts = data.map((v, i) => {
    const x = pad + i * step
    const y = pad + (height - pad * 2) * (1 - (v - min) / range)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const line = pts.join(" ")
  const area = `M${pts[0]} L${pts.slice(1).join(" L")} L${(width - pad).toFixed(2)},${height} L${pad},${height} Z`
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={fillOpacity * 3} />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={width - pad} cy={pts.length ? Number(pts[pts.length - 1].split(",")[1]) : height / 2} r={2} fill={stroke} />
    </svg>
  )
}
