import { useEffect, useRef } from 'react';
import {
  CYCLE_SECONDS,
  FRAME_COORDS,
  FRAME_COUNTS,
  FRAME_OFFSETS,
  FRAME_TONES,
  TOTAL_FRAMES,
} from './pointCloudData';

/*
 * TypeSafe-inspired computational point-cloud cube.
 *
 * Visual characteristics:
 * - Deterministic, two-part structure:
 *   - Dense cluster: untouched radiant white dots (#fbfbfa) preserving full solid facet planes.
 *   - Lighter cluster: vibrant green mint dots (#4befb5 / var(--accent)) providing cybernetic identity.
 * - Exact silhouette metamorphosis: smooth transitions between recognizable 3D
 *   isometric cube, compressed razor-thin slab, diamond, and folded open "V" chevron.
 * - Device-pixel snapped square particles with structured raster dither.
 */

export function PointCloudCube({ loading = false }: { loading?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const styles = getComputedStyle(canvas);
    const mintColor = styles.getPropertyValue('--accent').trim() || '#4befb5';

    let width = 0;
    let height = 0;
    let dpr = 1;
    let animFrame = 0;
    let lastTimestamp = 0;
    let isVisible = true;

    function draw() {
      if (!context || !width || !height) return;

      const t = motionQuery.matches ? 0 : elapsedRef.current;
      const progress = (t % CYCLE_SECONDS) / CYCLE_SECONDS;
      const frameIndex = motionQuery.matches
        ? 0
        : Math.floor(progress * TOTAL_FRAMES) % TOTAL_FRAMES;

      const start = FRAME_OFFSETS[frameIndex];
      const count = FRAME_COUNTS[frameIndex];
      const pointOffset = start >> 1;

      // Exact raster pitch scaled to card viewport (~112-120px bounding box)
      const baseScale = Math.min(width / 70, height / 64);
      const originX = width / 2;
      const originY = height / 2;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      // Render crisp square particles snapped to screen device pixels
      for (let i = 0; i < count; i += 1) {
        const gc = FRAME_COORDS[start + i * 2];
        const gr = FRAME_COORDS[start + i * 2 + 1];
        const tone = FRAME_TONES[pointOffset + i];

        const sx = originX + gc * baseScale;
        const sy = originY + gr * baseScale;

        // Snap to physical device pixels for raster sharpness
        const drawX = Math.round(sx * dpr) / dpr;
        const drawY = Math.round(sy * dpr) / dpr;
        const size = Math.max(1, Math.round(baseScale * 0.84 * dpr)) / dpr;

        if (tone === 0) {
          // Sharply defined white edge and corner point
          context.globalAlpha = 1.0;
          context.fillStyle = '#ffffff';
        } else if (tone === 1) {
          // Lighter cluster converted to vibrant green mint dots
          context.globalAlpha = 1.0;
          context.fillStyle = mintColor;
        } else {
          // Interior white cluster with 20% thinned breathing room
          context.globalAlpha = 0.94;
          context.fillStyle = '#fbfbfa';
        }

        context.fillRect(drawX, drawY, size, size);
      }

      context.globalAlpha = 1.0;
    }

    function animate(timestamp: number) {
      animFrame = 0;
      if (!isVisible || document.hidden || motionQuery.matches || loading) return;

      if (lastTimestamp) {
        elapsedRef.current += Math.min((timestamp - lastTimestamp) / 1000, 0.05);
      }
      lastTimestamp = timestamp;

      draw();
      animFrame = requestAnimationFrame(animate);
    }

    function sync() {
      cancelAnimationFrame(animFrame);
      animFrame = 0;
      lastTimestamp = 0;
      if (!isVisible || document.hidden) return;
      draw();
      if (!motionQuery.matches && !loading) {
        animFrame = requestAnimationFrame(animate);
      }
    }

    function resize() {
      if (!canvas) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      sync();
    }

    const resizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
      sync();
    });

    resizeObserver.observe(canvas);
    visibilityObserver.observe(canvas);
    motionQuery.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);

    resize();

    return () => {
      cancelAnimationFrame(animFrame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      motionQuery.removeEventListener('change', sync);
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
