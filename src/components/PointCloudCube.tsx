import { useEffect, useRef } from 'react';
import { CLOUD_POINTS, CYCLE_SECONDS } from './pointCloudData';

/*
 * TypeSafe-inspired computational point-cloud cube.
 *
 * Visual characteristics:
 * - Six square cube faces split into two complementary three-arm regions.
 * - One continuous 3D transform preserves both halves throughout the rotation.
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
    const projected = CLOUD_POINTS.map((point) => ({ point, x: 0, y: 0, z: 0 }));

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
      const turn = progress * Math.PI * 2;
      // Two slower orbits while tilting above and below the cube. Whole-period
      // motion closes smoothly, including velocity, at the end of the cycle.
      const ry = 0.65 + turn * 2;
      const rx = Math.sin(turn + Math.asin(0.5 / 1.35)) * 1.35;
      const rz = Math.sin(turn) * 0.22;
      const cy = Math.cos(ry),
        sy = Math.sin(ry);
      const cx = Math.cos(rx),
        sx = Math.sin(rx);
      const cz = Math.cos(rz),
        sz = Math.sin(rz);
      const cameraDistance = 5;
      // Rotated face normals dotted with camera position: a cube plane faces
      // the camera when distance * normal.z > 1. Keep shared edges only once.
      const normalZ = [sy * cx, -sy * cx, -sx, sx, -cy * cx, cy * cx];
      const visibleFaces = normalZ.reduce(
        (mask, z, index) => mask | (cameraDistance * z > 1 ? 1 << index : 0),
        0,
      );

      // Exact raster pitch scaled to card viewport (~112-120px bounding box)
      const baseScale = Math.min(width / 70, height / 64);
      const originX = width / 2;
      const originY = height / 2;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      for (const item of projected) {
        const p = item.point;
        const x = p.x * cy + p.z * sy;
        const z = -p.x * sy + p.z * cy;
        const y = p.y * cx - z * sx;
        item.z = p.y * sx + z * cx;
        const perspective = cameraDistance / (cameraDistance - item.z);
        item.x = originX + (x * cz - y * sz) * baseScale * 16 * perspective;
        item.y = originY + (x * sz + y * cz) * baseScale * 16 * perspective;
      }
      projected.sort((a, b) => a.z - b.z);
      // Draw back to front so overlap follows depth, never color priority.
      for (const item of projected) {
        if (!(item.point.faces & visibleFaces)) continue;
        // Snap to physical device pixels for raster sharpness
        const drawX = Math.round(item.x * dpr) / dpr;
        const drawY = Math.round(item.y * dpr) / dpr;
        const size =
          Math.max(1, Math.round(baseScale * (item.point.edge ? 1.04 : 0.94) * dpr)) / dpr;

        // A small, face-consistent lighting difference separates adjoining
        // square planes without outlines or changing either region's color.
        let faceLight = 0;
        for (let face = 0; face < normalZ.length; face += 1) {
          if (item.point.faces & visibleFaces & (1 << face)) {
            faceLight = Math.max(faceLight, 0.65 + normalZ[face] * 0.35);
          }
        }
        // The outer edges and both sides of the color seam share the same
        // full-brightness core and 50% broader halo in their original hue.
        const highlighted = item.point.edge || item.point.boundary;
        context.globalAlpha = highlighted ? 1 : faceLight;
        context.fillStyle = item.point.half === 0 ? '#ffffff' : mintColor;
        context.shadowColor = context.fillStyle;
        context.shadowBlur = highlighted ? 2.25 * dpr : 0;

        context.fillRect(drawX, drawY, size, size);
      }

      context.globalAlpha = 1.0;
      context.shadowBlur = 0;
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
