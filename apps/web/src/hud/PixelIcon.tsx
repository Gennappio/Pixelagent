import { ICONS, runs, sizeOf, type IconName } from "../pixel/bitmaps";

interface Props {
  name: IconName;
  /** Screen pixels per pixel of the bitmap. A whole number, so the icon stays crisp. */
  scale?: number;
  className?: string;
}

/** A pixel icon, drawn from its bitmap as rectangles in the colour of the text around it. */
export function PixelIcon({ name, scale = 2, className }: Props) {
  const bitmap = ICONS[name];
  const { width, height } = sizeOf(bitmap);
  const path = runs(bitmap)
    .map((run) => `M${run.x} ${run.y}h${run.width}v1h-${run.width}z`)
    .join("");
  return (
    <svg
      className={`pixel-icon${className ? ` ${className}` : ""}`}
      width={width * scale}
      height={height * scale}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
