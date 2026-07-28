export type PreparedSlipImage = Readonly<{
  blob: Blob;
  mime: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
  previewUrl: string;
  dispose(): void;
}>;

const supported = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5_000_000;
const MAX_EDGE = 2_000;

function canvasBlob(
  canvas: HTMLCanvasElement,
  mime: string
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("แปลงรูปไม่สำเร็จ")),
      mime,
      0.9
    );
  });
}

async function sha256(blob: Blob) {
  const bytes = Uint8Array.from(
    new Uint8Array(await blob.arrayBuffer())
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

export async function prepareSlipImage(
  file: File
): Promise<PreparedSlipImage> {
  if (!supported.has(file.type)) {
    throw new Error("รองรับเฉพาะรูป JPG, PNG และ WebP");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("รูปต้องมีขนาดไม่เกิน 5 MB");
  }
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image"
  });
  try {
    const scale = Math.min(
      1,
      MAX_EDGE / Math.max(bitmap.width, bitmap.height)
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("เตรียมรูปไม่สำเร็จ");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas, file.type);
    if (blob.size > MAX_BYTES) {
      throw new Error("รูปหลังเตรียมต้องมีขนาดไม่เกิน 5 MB");
    }
    const previewUrl = URL.createObjectURL(blob);
    let disposed = false;
    return {
      blob,
      mime: file.type as PreparedSlipImage["mime"],
      sha256: await sha256(blob),
      previewUrl,
      dispose() {
        if (!disposed) {
          URL.revokeObjectURL(previewUrl);
          disposed = true;
        }
      }
    };
  } finally {
    bitmap.close();
  }
}
