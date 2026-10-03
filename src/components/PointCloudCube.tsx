import { useEffect, useRef } from 'react';

type Point = {
  x: number;
  y: number;
  z: number;
  size: number;
  light: number;
  phase: number;
  tone: number;
};

// A repeatable, slightly incomplete lattice over six surfaces; no external assets.
function makePoints(): Point[] {
  let seed = 27183;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const points: Point[] = [];
  for (let face = 0; face < 6; face += 1) {
    for (let row = 0; row <= 12; row += 1) {
      for (let col = 0; col <= 12; col += 1) {
        const edge = row === 0 || row === 12 || col === 0 || col === 12;
        const missing = edge ? 0.035 : face % 2 === 0 ? 0.12 : 0.23;
        if (random() < missing) continue;
        const a = row / 6 - 1 + (random() - 0.5) * 0.07;
        const b = col / 6 - 1 + (random() - 0.5) * 0.07;
        const normal = (face % 2 === 0 ? 1 : -1) + (random() - 0.5) * 0.025;
        const [x, y, z] = face < 2 ? [normal, a, b] : face < 4 ? [a, normal, b] : [a, b, normal];
        points.push({
          x,
          y,
          z,
          size: 1.45 + random() * 0.65,
          light: (edge ? 0.9 : 0.8) + random() * 0.1,
          phase: random() * Math.PI * 2,
          tone: random() > 0.94 ? 1 : 0,
        });
      }
    }
  }
  return points;
}

const points = makePoints();

export function PointCloudCube({ loading = false }: { loading?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const colors = getComputedStyle(canvas);
    const palette = [
      colors.getPropertyValue('--accent').trim(),
      colors.getPropertyValue('--text-secondary').trim(),
    ];
    const projected = points.map((point) => ({ point, x: 0, y: 0, z: 0, size: 0, opacity: 0 }));
    let width = 0;
    let height = 0;
    let ratio = 1;
    let frame = 0;
    let previous = 0;
    let visible = true;

    function draw() {
      if (!context || !width || !height) return;
      const seconds = motion.matches ? 0 : elapsedRef.current;
      const yAngle = 0.68 + (seconds * Math.PI * 2) / 14;
      const xAngle = 0.47 + Math.sin(seconds * 0.45) * 0.1;
      const zAngle = -0.08 + Math.sin(seconds * 0.3) * 0.035;
      const cy = Math.cos(yAngle),
        sy = Math.sin(yAngle);
      const cx = Math.cos(xAngle),
        sx = Math.sin(xAngle);
      const cz = Math.cos(zAngle),
        sz = Math.sin(zAngle);
      const scale = Math.min(width, height) * 0.285;
      const distance = 5.5 + Math.sin(seconds * 0.35) * 0.1;

      for (const item of projected) {
        const p = item.point;
        const breathe = 1 + Math.sin(seconds * 0.7 + p.phase) * 0.008;
        const x = (p.x * cy + p.z * sy) * breathe;
        const z = (-p.x * sy + p.z * cy) * breathe;
        const y = p.y * cx - z * sx;
        item.z = p.y * sx + z * cx;
        const perspective = distance / (distance - item.z);
        item.x = width / 2 + (x * cz - y * sz) * scale * perspective;
        item.y = height / 2 + (x * sz + y * cz) * scale * perspective;
        const depth = Math.max(0, Math.min(1, (item.z + 1.75) / 3.5));
        item.opacity = (0.4 + depth * 0.58) * p.light;
        item.size = p.size * (0.85 + depth * 0.3);
      }
      projected.sort((a, b) => a.z - b.z);
      context.clearRect(0, 0, width, height);
      for (const item of projected) {
        context.globalAlpha = item.opacity;
        context.fillStyle = palette[item.point.tone];
        const size = Math.max(1, Math.round(item.size * ratio)) / ratio;
        context.fillRect(
          Math.round(item.x * ratio) / ratio,
          Math.round(item.y * ratio) / ratio,
          size,
          size,
        );
      }
      context.globalAlpha = 1;
    }

    function animate(timestamp: number) {
      frame = 0;
      if (!visible || document.hidden || motion.matches || loading) return;
      if (previous) elapsedRef.current += Math.min((timestamp - previous) / 1000, 0.05);
      previous = timestamp;
      draw();
      frame = requestAnimationFrame(animate);
    }

    function sync() {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (!visible || document.hidden) return;
      draw();
      if (!motion.matches && !loading) frame = requestAnimationFrame(animate);
    }

    function resize() {
      if (!canvas || !context) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      sync();
    }

    const sizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    sizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      sizeObserver.disconnect();
      visibilityObserver.disconnect();
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [loading]);

  return (
    <div
      className={`point-cloud-cube ${loading ? 'point-cloud-cube-loading' : ''}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
