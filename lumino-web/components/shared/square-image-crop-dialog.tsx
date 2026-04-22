"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const CROP_BOX_SIZE = 320;
const OUTPUT_SIZE = 800;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampOffset(offset: number, renderedSize: number) {
  const maxOffset = Math.max(0, (renderedSize - CROP_BOX_SIZE) / 2);
  return clamp(offset, -maxOffset, maxOffset);
}

function fileNameToPng(name: string) {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  return `${withoutExtension || "image"}-cropped.png`;
}

export function SquareImageCropDialog({
  file,
  title = "Crop image",
  open,
  onCancel,
  onConfirm
}: {
  file: File | null;
  title?: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    if (!file || !open) return;
    const nextUrl = URL.createObjectURL(file);
    setImageUrl(nextUrl);
    setZoom(1);
    setOffsetX(0);
    setOffsetY(0);
    return () => {
      URL.revokeObjectURL(nextUrl);
      setImageUrl(null);
      setImageElement(null);
    };
  }, [file, open]);

  const baseScale = useMemo(() => {
    if (!imageElement) return 1;
    return Math.max(CROP_BOX_SIZE / imageElement.naturalWidth, CROP_BOX_SIZE / imageElement.naturalHeight);
  }, [imageElement]);

  const renderedWidth = useMemo(
    () => (imageElement ? imageElement.naturalWidth * baseScale * zoom : 0),
    [baseScale, imageElement, zoom]
  );
  const renderedHeight = useMemo(
    () => (imageElement ? imageElement.naturalHeight * baseScale * zoom : 0),
    [baseScale, imageElement, zoom]
  );

  useEffect(() => {
    setOffsetX((current) => clampOffset(current, renderedWidth));
    setOffsetY((current) => clampOffset(current, renderedHeight));
  }, [renderedHeight, renderedWidth]);

  if (!open || !file) return null;

  const canConfirm = Boolean(imageElement && imageUrl);

  async function handleConfirm() {
    if (!imageElement || !file) return;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;

    const scaleFactor = OUTPUT_SIZE / CROP_BOX_SIZE;
    const drawWidth = renderedWidth * scaleFactor;
    const drawHeight = renderedHeight * scaleFactor;
    const drawX = ((CROP_BOX_SIZE - renderedWidth) / 2 + offsetX) * scaleFactor;
    const drawY = ((CROP_BOX_SIZE - renderedHeight) / 2 + offsetY) * scaleFactor;

    context.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    context.drawImage(imageElement, drawX, drawY, drawWidth, drawHeight);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
    if (!blob) return;

    onConfirm(new File([blob], fileNameToPng(file.name), { type: "image/png" }));
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX,
      offsetY
    };
    setDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current) return;
    event.preventDefault();
    const deltaX = event.clientX - dragStartRef.current.x;
    const deltaY = event.clientY - dragStartRef.current.y;
    setOffsetX(clampOffset(dragStartRef.current.offsetX + deltaX, renderedWidth));
    setOffsetY(clampOffset(dragStartRef.current.offsetY + deltaY, renderedHeight));
  }

  function handlePointerUp() {
    dragStartRef.current = null;
    setDragging(false);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-mist">Image Crop</div>
            <h3 className="mt-2 text-2xl font-semibold text-ink">{title}</h3>
            <p className="mt-2 text-sm text-[rgba(var(--app-primary-rgb),0.62)]">
              Drag the image inside the square and use zoom if needed. What you see here is what will be saved.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-6 flex justify-center">
          <div
            className={`relative overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-100 shadow-inner ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            style={{ width: CROP_BOX_SIZE, height: CROP_BOX_SIZE, touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt="Crop preview"
                  onLoad={(event) => setImageElement(event.currentTarget)}
                  draggable={false}
                  className="select-none object-contain"
                  style={{
                    width: imageElement ? imageElement.naturalWidth * baseScale : CROP_BOX_SIZE,
                    height: imageElement ? imageElement.naturalHeight * baseScale : CROP_BOX_SIZE,
                    transform: `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`,
                    transformOrigin: "center center"
                  }}
                />
              ) : null}
            </div>
            <div className="pointer-events-none absolute inset-0 rounded-[2rem] ring-1 ring-white/80" />
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Zoom</div>
            <div className="text-xs text-slate-500">{Math.round(zoom * 100)}%</div>
          </div>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="mt-3 w-full accent-[var(--app-primary)]"
          />
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
            className="rounded-2xl bg-[rgba(var(--app-primary-rgb),0.96)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Use Crop
          </button>
        </div>
      </div>
    </div>
  );
}
