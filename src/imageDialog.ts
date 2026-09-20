import {
  type Adjustments,
  type CropRect,
  FULL_FRAME,
  NEUTRAL,
  blobToBase64,
  encodeWithinBudget,
  formatBytes,
  imageFileName,
  loadImage,
  renderToCanvas,
} from "./imaging.js";
import { IMAGES_DIR } from "./config.js";
import { uploadImage } from "./github.js";

interface Preset {
  label: string;
  adjustments: Adjustments;
}

const PRESETS: Preset[] = [
  { label: "None", adjustments: NEUTRAL },
  { label: "Neon", adjustments: { brightness: 105, contrast: 135, saturation: 175, hue: -12 } },
  { label: "Noir", adjustments: { brightness: 104, contrast: 130, saturation: 0, hue: 0 } },
  { label: "Cold", adjustments: { brightness: 100, contrast: 115, saturation: 120, hue: 25 } },
];

/** Preview is capped so the editor stays responsive on large photographs. */
const PREVIEW_EDGE = 620;

export interface ImageInsert {
  markdown: string;
}

/**
 * Opens the upload-and-edit dialog. Resolves with the Markdown to insert once the
 * image is committed, or null if the user cancels.
 */
export function openImageDialog(file: File): Promise<ImageInsert | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "image-dialog";

    const title = document.createElement("h2");
    title.textContent = "Add image";

    const stage = document.createElement("div");
    stage.className = "image-stage";
    const preview = document.createElement("canvas");
    const cropBox = document.createElement("div");
    cropBox.className = "crop-box hidden";
    stage.append(preview, cropBox);

    const status = document.createElement("p");
    status.className = "muted image-status";
    status.textContent = "Loading…";

    const altInput = document.createElement("input");
    altInput.type = "text";
    altInput.placeholder = "Describe the image (used as alt text)";

    const controls = document.createElement("div");
    controls.className = "image-controls";

    const rotateBtn = makeButton("Rotate");
    const cropBtn = makeButton("Crop");
    const resetBtn = makeButton("Reset");
    controls.append(rotateBtn, cropBtn, resetBtn);

    const presetRow = document.createElement("div");
    presetRow.className = "image-presets";
    for (const preset of PRESETS) {
      const button = makeButton(preset.label);
      button.addEventListener("click", () => {
        adjustments = { ...preset.adjustments };
        syncSliders();
        schedulePreview();
      });
      presetRow.append(button);
    }

    const sliders = document.createElement("div");
    sliders.className = "image-sliders";
    const brightness = makeSlider("Brightness", 40, 180, NEUTRAL.brightness);
    const contrast = makeSlider("Contrast", 40, 200, NEUTRAL.contrast);
    const saturation = makeSlider("Saturation", 0, 240, NEUTRAL.saturation);
    sliders.append(brightness.row, contrast.row, saturation.row);

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancelBtn = makeButton("Cancel");
    const uploadBtn = makeButton("Upload", "primary");
    actions.append(cancelBtn, uploadBtn);

    dialog.append(title, stage, status, altInput, controls, presetRow, sliders, actions);
    document.body.append(dialog);
    dialog.showModal();

    let source: HTMLImageElement | null = null;
    let rotation = 0;
    let crop: CropRect = { ...FULL_FRAME };
    let adjustments: Adjustments = { ...NEUTRAL };
    let cropping = false;
    let previewTimer = 0;
    let sizeToken = 0;

    function makeButton(label: string, className = ""): HTMLButtonElement {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (className) button.className = className;
      return button;
    }

    function makeSlider(label: string, min: number, max: number, value: number) {
      const row = document.createElement("label");
      row.className = "slider-row";
      const caption = document.createElement("span");
      caption.textContent = label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(min);
      input.max = String(max);
      input.value = String(value);
      row.append(caption, input);
      input.addEventListener("input", () => {
        adjustments = {
          brightness: Number(brightness.input.value),
          contrast: Number(contrast.input.value),
          saturation: Number(saturation.input.value),
          hue: adjustments.hue,
        };
        schedulePreview();
      });
      return { row, input };
    }

    function syncSliders(): void {
      brightness.input.value = String(adjustments.brightness);
      contrast.input.value = String(adjustments.contrast);
      saturation.input.value = String(adjustments.saturation);
    }

    function drawPreview(): void {
      if (!source) return;
      const canvas = renderToCanvas(source, crop, rotation, adjustments, PREVIEW_EDGE);
      preview.width = canvas.width;
      preview.height = canvas.height;
      const context = preview.getContext("2d");
      context?.drawImage(canvas, 0, 0);
    }

    /** Re-encodes off the critical path so dragging a slider stays smooth. */
    function schedulePreview(): void {
      drawPreview();
      window.clearTimeout(previewTimer);
      // Re-encoding a large photo is slow enough to see, so clear the old figure
      // rather than leave a stale size on screen while it recomputes.
      status.className = "muted image-status";
      status.textContent = "Calculating size…";
      previewTimer = window.setTimeout(() => void reportSize(), 260);
    }

    async function reportSize(): Promise<void> {
      if (!source) return;
      const token = ++sizeToken;
      const encoded = await encodeWithinBudget(source, crop, rotation, adjustments);
      // A newer edit started while this was encoding; its result wins.
      if (token !== sizeToken) return;
      status.className = "muted image-status";
      status.textContent = `${encoded.width}×${encoded.height} · ${formatBytes(encoded.blob.size)} after compression`;
    }

    // --- Crop interaction: drag a rectangle over the preview ---
    let dragStart: { x: number; y: number } | null = null;

    function previewPoint(event: PointerEvent): { x: number; y: number } {
      const rect = preview.getBoundingClientRect();
      return {
        x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
        y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
      };
    }

    function onCropDown(event: PointerEvent): void {
      if (!cropping) return;
      dragStart = previewPoint(event);
      cropBox.classList.remove("hidden");
      preview.setPointerCapture(event.pointerId);
    }

    function onCropMove(event: PointerEvent): void {
      if (!cropping || !dragStart) return;
      const now = previewPoint(event);
      const rect = preview.getBoundingClientRect();
      const left = Math.min(dragStart.x, now.x);
      const top = Math.min(dragStart.y, now.y);
      const width = Math.abs(now.x - dragStart.x);
      const height = Math.abs(now.y - dragStart.y);

      cropBox.style.left = `${preview.offsetLeft + left * rect.width}px`;
      cropBox.style.top = `${preview.offsetTop + top * rect.height}px`;
      cropBox.style.width = `${width * rect.width}px`;
      cropBox.style.height = `${height * rect.height}px`;
    }

    function onCropUp(event: PointerEvent): void {
      if (!cropping || !dragStart) return;
      const end = previewPoint(event);
      const left = Math.min(dragStart.x, end.x);
      const top = Math.min(dragStart.y, end.y);
      const width = Math.abs(end.x - dragStart.x);
      const height = Math.abs(end.y - dragStart.y);
      dragStart = null;

      // Ignore an accidental click: too small a rectangle is not a crop.
      if (width < 0.04 || height < 0.04) {
        cropBox.classList.add("hidden");
        return;
      }

      // Compose with the existing crop so successive crops narrow further.
      crop = {
        x: crop.x + left * crop.width,
        y: crop.y + top * crop.height,
        width: crop.width * width,
        height: crop.height * height,
      };

      cropping = false;
      cropBtn.classList.remove("active");
      cropBox.classList.add("hidden");
      stage.classList.remove("is-cropping");
      schedulePreview();
    }

    preview.addEventListener("pointerdown", onCropDown);
    preview.addEventListener("pointermove", onCropMove);
    preview.addEventListener("pointerup", onCropUp);

    rotateBtn.addEventListener("click", () => {
      rotation = (rotation + 90) % 360;
      schedulePreview();
    });

    cropBtn.addEventListener("click", () => {
      cropping = !cropping;
      cropBtn.classList.toggle("active", cropping);
      stage.classList.toggle("is-cropping", cropping);
      if (!cropping) cropBox.classList.add("hidden");
    });

    resetBtn.addEventListener("click", () => {
      rotation = 0;
      crop = { ...FULL_FRAME };
      adjustments = { ...NEUTRAL };
      cropping = false;
      cropBtn.classList.remove("active");
      stage.classList.remove("is-cropping");
      cropBox.classList.add("hidden");
      syncSliders();
      schedulePreview();
    });

    function close(result: ImageInsert | null): void {
      window.clearTimeout(previewTimer);
      dialog.close();
      dialog.remove();
      resolve(result);
    }

    cancelBtn.addEventListener("click", () => close(null));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close(null);
    });

    uploadBtn.addEventListener("click", () => {
      void (async () => {
        if (!source) return;
        uploadBtn.disabled = true;
        cancelBtn.disabled = true;
        status.className = "muted image-status";
        status.textContent = "Compressing…";

        try {
          const encoded = await encodeWithinBudget(source, crop, rotation, adjustments);
          status.textContent = `Uploading ${formatBytes(encoded.blob.size)}…`;

          const name = imageFileName(file.name);
          await uploadImage(name, await blobToBase64(encoded.blob));

          const alt = altInput.value.trim() || name.replace(/-[a-z0-9]+\.jpg$/, "").replace(/-/g, " ");
          close({ markdown: `![${alt}](${IMAGES_DIR}/${name})` });
        } catch (error) {
          uploadBtn.disabled = false;
          cancelBtn.disabled = false;
          status.className = "error image-status";
          status.textContent = error instanceof Error ? error.message : String(error);
        }
      })();
    });

    void (async () => {
      try {
        source = await loadImage(file);
        status.textContent = `Original ${source.width}×${source.height} · ${formatBytes(file.size)}`;
        schedulePreview();
      } catch (error) {
        status.className = "error image-status";
        status.textContent = error instanceof Error ? error.message : String(error);
        uploadBtn.disabled = true;
      }
    })();
  });
}
