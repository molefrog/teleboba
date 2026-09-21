import { useLayoutEffect, useRef } from "react";
import { animate, createSpring, splitText, stagger } from "animejs";

export function AnimatedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    el.textContent = text;

    const split = splitText(el, {
      words: true,
      chars: true,
    });

    const anim = animate(split.chars, {
      y: ["0.4em", "0em"],
      opacity: [0, 1],
      duration: 520,
      delay: stagger(12),
      ease: createSpring({ stiffness: 140, damping: 16 }),
    });

    return () => {
      anim.pause();
      split.revert();
    };
  }, [text]);

  return <span ref={containerRef} className={className} aria-label={text} />;
}
