import { motion } from "motion/react";
import type { TimelinePoint } from "../types";

const SPRING = { type: "spring", stiffness: 260, damping: 32 } as const;

export function Timeline({ points }: { points: TimelinePoint[] }) {
  if (points.length === 0) return null;

  const n = points.length;
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };

  return (
    <div className="w-full max-w-[1100px] px-10">
      <div className="grid items-end gap-y-6" style={cols}>
        {points.map((p, i) => (
          <motion.div
            layout="position"
            key={`t-${p.title}-${i}`}
            transition={SPRING}
            style={{ gridRow: 1, gridColumn: i + 1 }}
            className="text-center text-[clamp(1.5rem,3vw,2.25rem)] font-semibold tracking-[-0.015em] leading-[1.1] text-fg"
          >
            {p.title}
          </motion.div>
        ))}

        <div
          style={{ gridRow: 2, gridColumn: `1 / -1` }}
          className="relative"
        >
          <div
            className="absolute top-1/2 h-px -translate-y-1/2 bg-fg/30"
            style={{ left: `calc(50% / ${n})`, right: `calc(50% / ${n})` }}
          />
          <div className="relative grid" style={cols}>
            {points.map((p, i) => (
              <div key={`d-${p.title}-${i}`} className="flex justify-center">
                <motion.div
                  layout
                  transition={SPRING}
                  className="size-4 rounded-full bg-accent shadow-[0_0_0_6px_rgba(232,90,60,0.18)]"
                />
              </div>
            ))}
          </div>
        </div>

        {points.map((p, i) =>
          p.caption ? (
            <motion.div
              layout="position"
              key={`c-${p.title}-${i}`}
              transition={SPRING}
              style={{ gridRow: 3, gridColumn: i + 1 }}
              className="mx-auto max-w-[260px] text-center text-[19px] leading-[1.4] font-medium text-fg"
            >
              {p.caption}
            </motion.div>
          ) : null,
        )}
      </div>
    </div>
  );
}
