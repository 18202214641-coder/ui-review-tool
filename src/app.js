const analyzeImages = window.UIReviewDetection?.analyzeImages;

const state = {
  designImage: null,
  devImage: null,
  issues: [],
  selectedIssueId: null,
  issueFilter: "all",
  showOverlay: true,
  showAllBoxes: false,
  fitScale: 1,
  zoomLevel: 1,
  displayScale: 1,
};

const touchZoomState = {
  active: false,
  startDistance: 0,
  startZoom: 1,
  anchorCanvasX: 0,
  anchorCanvasY: 0,
};

const designInput = document.querySelector("#design-input");
const devInput = document.querySelector("#dev-input");
const designMeta = document.querySelector("#design-meta");
const devMeta = document.querySelector("#dev-meta");
const designCard = document.querySelector("#design-panel");
const devCard = document.querySelector("#dev-panel");
const designState = document.querySelector("#design-state");
const devState = document.querySelector("#dev-state");
const issueTotal = document.querySelector("#issue-total");
const modeState = document.querySelector("#mode-state");
const designTag = document.querySelector("#design-tag");
const devTag = document.querySelector("#dev-tag");
const designPreview = document.querySelector("#design-preview");
const devPreview = document.querySelector("#dev-preview");
const compareButton = document.querySelector("#compare-button");
const resetButton = document.querySelector("#reset-button");
const overlayToggle = document.querySelector("#overlay-toggle");
const allBoxesToggle = document.querySelector("#all-boxes-toggle");
const overlayChip = overlayToggle.closest(".toggle-chip");
const allBoxesChip = allBoxesToggle.closest(".toggle-chip");
const statusBanner = document.querySelector("#status-banner");
const canvas = document.querySelector("#review-canvas");
const canvasScroll = document.querySelector("#canvas-scroll");
const canvasSize = document.querySelector("#canvas-size");
const zoomOutButton = document.querySelector("#zoom-out-button");
const zoomResetButton = document.querySelector("#zoom-reset-button");
const zoomInButton = document.querySelector("#zoom-in-button");
const issuesList = document.querySelector("#issues-list");
const issueSummary = document.querySelector("#issue-summary");
const issueFilterMeta = document.querySelector("#issue-filter-meta");
const selectedIssueCard = document.querySelector("#selected-issue-card");
const focusHint = document.querySelector("#focus-hint");
const issueItemTemplate = document.querySelector("#issue-item-template");
const issueFilterButtons = Array.from(document.querySelectorAll("[data-issue-filter]"));
const highCount = document.querySelector("#high-count");
const mediumCount = document.querySelector("#medium-count");
const lowCount = document.querySelector("#low-count");

const ctx = canvas.getContext("2d", { willReadFrequently: true });

const REVIEW_STATUS_LABELS = {
  pending: "待确认",
  confirmed: "已确认",
  ignored: "已忽略",
};

bindEvents();
render();

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setHTML(element, value) {
  if (element) {
    element.innerHTML = value;
  }
}

function setClassName(element, value) {
  if (element) {
    element.className = value;
  }
}

function toggleClass(element, className, enabled) {
  if (element) {
    element.classList.toggle(className, enabled);
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function bindEvents() {
  designInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      state.designImage = await loadImageFile(file);
      setText(designMeta, buildMetaText(state.designImage));
      updateCompareButton();
      render();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  devInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      state.devImage = await loadImageFile(file);
      setText(devMeta, buildMetaText(state.devImage));
      updateCompareButton();
      render();
    } catch (error) {
      setStatus(error.message, "error");
    }
  });

  compareButton.addEventListener("click", runComparison);
  resetButton.addEventListener("click", resetApp);

  overlayToggle.addEventListener("change", () => {
    state.showOverlay = overlayToggle.checked;
    renderModeState();
    drawCanvas();
  });

  allBoxesToggle.addEventListener("change", () => {
    state.showAllBoxes = allBoxesToggle.checked;
    renderModeState();
    drawCanvas();
  });

  issueFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.issueFilter = button.dataset.issueFilter || "all";
      renderIssues();
    });
  });

  zoomOutButton?.addEventListener("click", () => {
    state.zoomLevel = clamp(state.zoomLevel / 1.2, 0.25, 6);
    applyCanvasScale();
  });

  zoomResetButton?.addEventListener("click", () => {
    state.zoomLevel = 1;
    applyCanvasScale();
  });

  zoomInButton?.addEventListener("click", () => {
    state.zoomLevel = clamp(state.zoomLevel * 1.2, 0.25, 6);
    applyCanvasScale();
  });

  canvasScroll?.addEventListener("touchstart", handleCanvasTouchStart, { passive: false });
  canvasScroll?.addEventListener("touchmove", handleCanvasTouchMove, { passive: false });
  canvasScroll?.addEventListener("touchend", handleCanvasTouchEnd);
  canvasScroll?.addEventListener("touchcancel", handleCanvasTouchEnd);

  window.addEventListener("resize", () => {
    fitCanvasToViewport();
  });
}

async function runComparison() {
  if (typeof analyzeImages !== "function") {
    setStatus("检测脚本没有成功加载，请直接重新打开 index.html，或在本地静态服务中访问。", "error");
    return;
  }

  if (!state.designImage || !state.devImage) {
    setStatus("请先上传两张截图。", "warning");
    return;
  }

  if (
    state.designImage.width !== state.devImage.width ||
    state.designImage.height !== state.devImage.height
  ) {
    state.issues = [];
    state.selectedIssueId = null;
    renderIssues();
    setStatus("两张截图尺寸不一致，请重新上传同尺寸图片。", "error");
    return;
  }

  setStatus("正在执行检测，请稍候...", "neutral");

  try {
    const designData = getImageData(state.designImage);
    const devData = getImageData(state.devImage);
    const issues = analyzeImages(designData, devData).map((issue, index) => ({
      ...issue,
      reviewStatus: "pending",
      note: "",
      source: "rule",
      expanded: index === 0,
    }));

    state.issues = issues;
    state.issueFilter = "all";
    state.selectedIssueId = issues[0]?.id ?? null;
    drawCanvas();
    renderIssues();

    if (issues.length === 0) {
      setStatus("本次未检测到明显视觉问题，建议继续人工复核边缘细节。", "success");
    } else {
      setStatus(`检测完成，共发现 ${issues.length} 个明显问题。`, "success");
    }
  } catch (error) {
    setStatus(error.message || "检测失败，请检查截图后重试。", "error");
  }
}

function resetApp() {
  state.designImage = null;
  state.devImage = null;
  state.issues = [];
  state.selectedIssueId = null;
  state.issueFilter = "all";
  state.fitScale = 1;
  state.zoomLevel = 1;
  designInput.value = "";
  devInput.value = "";
  setText(designMeta, "未上传");
  setText(devMeta, "未上传");
  overlayToggle.checked = true;
  allBoxesToggle.checked = false;
  state.showOverlay = true;
  state.showAllBoxes = false;
  setStatus("上传两张同尺寸截图后开始检测。", "neutral");
  updateCompareButton();
  render();
}

function render() {
  renderUploadState();
  renderOverview();
  drawCanvas();
  renderIssues();
  updateCompareButton();
}

function updateCompareButton() {
  if (!compareButton) {
    return;
  }

  compareButton.disabled = !(state.designImage && state.devImage) || typeof analyzeImages !== "function";
  setText(compareButton, state.issues.length ? "重新检测" : "开始检测");
}

function renderUploadState() {
  toggleClass(designCard, "ready", Boolean(state.designImage));
  toggleClass(devCard, "ready", Boolean(state.devImage));

  setText(designState, state.designImage ? "已上传" : "未上传");
  setText(devState, state.devImage ? "已上传" : "未上传");
  setText(designTag, state.designImage ? "已上传" : "等待上传");
  setText(devTag, state.devImage ? "已上传" : "等待上传");

  toggleClass(designPreview, "ready", Boolean(state.designImage));
  toggleClass(devPreview, "ready", Boolean(state.devImage));
  toggleClass(designPreview, "empty", !state.designImage);
  toggleClass(devPreview, "empty", !state.devImage);
  renderAssetPreview(designPreview, state.designImage, "design");
  renderAssetPreview(devPreview, state.devImage, "develop");

  renderModeState();
}

function renderOverview() {
  const counts = { high: 0, medium: 0, low: 0 };

  for (const issue of state.issues) {
    if (counts[issue.severity] !== undefined) {
      counts[issue.severity] += 1;
    }
  }

  setText(highCount, counts.high);
  setText(mediumCount, counts.medium);
  setText(lowCount, counts.low);
  setText(issueTotal, state.issues.length);
}

function renderModeState() {
  toggleClass(overlayChip, "active", state.showOverlay);
  toggleClass(allBoxesChip, "active", state.showAllBoxes);

  if (!modeState) {
    return;
  }

  if (state.showOverlay && state.showAllBoxes) {
    setText(modeState, "叠层 + 全部问题框");
    return;
  }

  if (state.showOverlay) {
    setText(modeState, "设计稿叠层");
    return;
  }

  if (state.showAllBoxes) {
    setText(modeState, "全部问题框");
    return;
  }

  setText(modeState, "仅当前选中问题");
}

function drawCanvas() {
  const image = state.devImage ?? state.designImage;
  if (!image) {
    canvas.width = 960;
    canvas.height = 640;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawEmptyCanvas();
    fitCanvasToViewport();
    setText(canvasSize, "等待上传");
    return;
  }

  canvas.width = image.width;
  canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.devImage ?? state.designImage, 0, 0);

  if (state.showOverlay && state.designImage && state.devImage) {
    ctx.save();
    ctx.globalAlpha = 0.24;
    ctx.drawImage(state.designImage, 0, 0);
    ctx.restore();
  }

  if (state.showAllBoxes) {
    for (const issue of state.issues) {
      drawIssueBox(issue, issue.id === state.selectedIssueId ? 1 : 0.45);
    }
  } else if (state.selectedIssueId) {
    const issue = state.issues.find((item) => item.id === state.selectedIssueId);
    if (issue) {
      drawIssueBox(issue, 1);
    }
  }

  fitCanvasToViewport();
  setText(
    canvasSize,
    `${image.width} × ${image.height} · 适配 ${Math.round(state.fitScale * 100)}% · 缩放 ${Math.round(state.zoomLevel * 100)}%`
  );
}

function drawEmptyCanvas() {
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#07101e");
  gradient.addColorStop(1, "#040814");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#f3f7ff";
  ctx.font = "600 24px 'IBM Plex Sans', 'PingFang SC', sans-serif";
  ctx.fillText("UI 验收画布", 72, 120);
  ctx.font = "14px 'IBM Plex Sans', 'PingFang SC', sans-serif";
  ctx.fillStyle = "#8998bc";
  ctx.fillText("上传设计稿和开发截图后，这里会高亮明显的视觉偏差区域。", 72, 164);
  ctx.fillText("建议先看高优先级问题，再结合叠层和问题框查看整体偏差。", 72, 194);

  ctx.strokeStyle = "rgba(118, 141, 197, 0.22)";
  ctx.setLineDash([12, 12]);
  ctx.lineWidth = 2;
  ctx.strokeRect(72, 216, canvas.width - 144, canvas.height - 288);
  ctx.setLineDash([]);
}

function drawIssueBox(issue, alpha) {
  const color = severityColor(issue.severity);
  const { x, y, width, height } = issue.bbox;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color + "22";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.font = "600 14px 'IBM Plex Sans', 'PingFang SC', sans-serif";
  ctx.fillText(issue.title, x + 8, Math.max(18, y - 10));
  ctx.restore();
}

function renderIssues() {
  const visibleIssues = getVisibleIssues();
  renderIssueFilters(visibleIssues.length);

  setText(
    issueSummary,
    state.designImage && state.devImage ? `${visibleIssues.length} 个候选问题` : "0 个候选问题"
  );

  if (!state.issues.length) {
    setClassName(issuesList, "issues-list empty");
    setText(
      issuesList,
      state.designImage && state.devImage
        ? "当前结果中没有明显问题，建议继续人工复核边缘细节。"
        : "验收完成后，这里会列出可高亮查看的问题卡片。"
    );
    setClassName(selectedIssueCard, "selected-issue-card empty");
    setText(selectedIssueCard, "选中问题后，这里会显示更详细的说明与定位信息。");
    setText(focusHint, "选择右侧问题后会在画布中高亮对应区域");
    renderAssetPreview(designPreview, state.designImage, "design");
    renderAssetPreview(devPreview, state.devImage, "develop");
    return;
  }

  if (!issuesList) {
    return;
  }

  const selectedVisibleIssue =
    visibleIssues.find((item) => item.id === state.selectedIssueId) ??
    visibleIssues[0] ??
    null;

  state.selectedIssueId = selectedVisibleIssue?.id ?? state.selectedIssueId;

  if (!visibleIssues.length) {
    setClassName(issuesList, "issues-list empty");
    setText(issuesList, "当前筛选下没有问题，切换筛选项或调整问题状态后再查看。");
    setClassName(selectedIssueCard, "selected-issue-card empty");
    setText(selectedIssueCard, "当前筛选没有命中问题，已保留原始问题列表。");
    setText(focusHint, "切换筛选后，可继续查看对应问题");
    renderAssetPreview(designPreview, state.designImage, "design");
    renderAssetPreview(devPreview, state.devImage, "develop");
    return;
  }

  setClassName(issuesList, "issues-list");
  setHTML(issuesList, "");

  visibleIssues.forEach((issue, index) => {
    const fragment = issueItemTemplate.content.cloneNode(true);
    const item = fragment.querySelector(".issue-item");
    const severityPill = fragment.querySelector(".issue-severity-pill");
    const typePill = fragment.querySelector(".issue-type-pill");
    const statusButton = fragment.querySelector(".issue-status-button");
    const expandButton = fragment.querySelector(".issue-expand-button");
    const mainButton = fragment.querySelector(".issue-card-main");
    const confidence = fragment.querySelector(".issue-confidence");
    const issueIndex = fragment.querySelector(".issue-index");
    const issueRegion = fragment.querySelector(".issue-region");
    const title = fragment.querySelector(".issue-title");
    const description = fragment.querySelector(".issue-description");
    const detail = fragment.querySelector(".issue-item-detail");

    if (!item) {
      return;
    }

    setText(severityPill, severityLabel(issue.severity));
    setText(typePill, typeLabel(issue.type));
    setText(statusButton, REVIEW_STATUS_LABELS[issue.reviewStatus] ?? "待确认");
    statusButton?.classList.add(`status-${issue.reviewStatus}`);
    setText(expandButton, issue.expanded ? "▴" : "▾");
    setText(confidence, `置信度 ${Math.round(issue.confidence * 100)}%`);
    setText(issueIndex, `#${String(index + 1).padStart(2, "0")}`);
    setText(issueRegion, `${issue.bbox.width} × ${issue.bbox.height}`);
    setText(title, issue.title);
    setText(description, issue.description);
    if (issue.id === state.selectedIssueId && item) {
      item.classList.add("active");
    }

    const handleSelectIssue = () => {
      state.selectedIssueId = issue.id;
      issue.expanded = true;
      renderIssues();
      drawCanvas();
      focusIssue(issue);
    };

    item.addEventListener("click", (event) => {
      if (
        event.target.closest(".issue-expand-button") ||
        event.target.closest(".issue-review-button") ||
        event.target.closest(".issue-note-input")
      ) {
        return;
      }
      handleSelectIssue();
    });

    mainButton?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSelectIssue();
      }
    });

    expandButton?.addEventListener("click", () => {
      issue.expanded = !issue.expanded;
      state.selectedIssueId = issue.id;
      renderIssues();
      drawCanvas();
      focusIssue(issue);
    });

    renderIssueDetail(detail, issue);
    issuesList.appendChild(fragment);
  });

  const selectedIssue = selectedVisibleIssue;
  renderSelectedIssue(selectedIssue);
}

function renderSelectedIssue(issue) {
  if (!selectedIssueCard) {
    return;
  }

  if (!issue) {
    setClassName(selectedIssueCard, "selected-issue-card empty");
    setText(selectedIssueCard, "选中问题后，这里会显示更详细的说明与定位信息。");
    return;
  }

  setClassName(selectedIssueCard, "selected-issue-card");
  setHTML(selectedIssueCard, `
    <h3>${issue.title}</h3>
    <p>${issue.description}</p>
    <div class="issue-meta">
      <span>类型 · ${typeLabel(issue.type)}</span>
      <span>优先级 · ${severityLabel(issue.severity)}</span>
      <span>状态 · ${REVIEW_STATUS_LABELS[issue.reviewStatus] ?? "待确认"}</span>
      <span>置信度 · ${Math.round(issue.confidence * 100)}%</span>
      <span>区域 · ${issue.bbox.x}, ${issue.bbox.y}, ${issue.bbox.width} × ${issue.bbox.height}</span>
    </div>
  `);
  setText(focusHint, "当前问题已高亮，可结合叠层继续复核");
  renderAssetPreview(designPreview, state.designImage, "design", issue);
  renderAssetPreview(devPreview, state.devImage, "develop", issue);
}

function focusIssue(issue) {
  setText(focusHint, `已在画布中高亮 ${typeLabel(issue.type)} 问题`);
}

function renderIssueFilters(visibleCount) {
  setText(issueFilterMeta, `当前显示 ${visibleCount} / ${state.issues.length}`);
  issueFilterButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.issueFilter === state.issueFilter);
  });
}

function getVisibleIssues() {
  if (state.issueFilter === "all") {
    return state.issues;
  }

  return state.issues.filter((issue) => issue.reviewStatus === state.issueFilter);
}

function renderIssueDetail(container, issue) {
  if (!container) {
    return;
  }

  container.hidden = !issue.expanded;
  if (!issue.expanded) {
    setHTML(container, "");
    return;
  }

  const details = [
    `类型: ${typeLabel(issue.type)}`,
    `来源: ${issue.source === "rule" ? "规则" : issue.source}`,
    `置信度: ${Math.round(issue.confidence * 100)}%`,
    `问题框: ${issue.bbox.x}, ${issue.bbox.y}, ${issue.bbox.width} × ${issue.bbox.height}`,
    `色差: ${formatMetric(issue.metrics?.colorDelta, 1)}`,
    `亮度变化: ${formatSignedMetric(issue.metrics?.brightnessDelta, 1)}`,
    `重心偏移: X ${formatSignedMetric(issue.metrics?.horizontalShift, 1)}px / Y ${formatSignedMetric(issue.metrics?.verticalShift, 1)}px`,
    `边缘密度差: ${formatSignedMetric(issue.metrics?.edgeDelta, 2)}`,
    `圆角差异: ${formatMetric(issue.metrics?.cornerDelta, 2)}`,
  ];

  setHTML(
    container,
    `
      <ul class="issue-detail-list">
        ${details.map((item) => `<li>${item}</li>`).join("")}
      </ul>
      <div class="issue-review-actions">
        <button class="issue-review-button" type="button" data-review-action="pending">标记待确认</button>
        <button class="issue-review-button confirm" type="button" data-review-action="confirmed">确认问题</button>
        <button class="issue-review-button ignore" type="button" data-review-action="ignored">忽略问题</button>
      </div>
      <label class="issue-note-field">
        <span>备注</span>
        <textarea class="issue-note-input" rows="4" placeholder="记录修正建议、责任人或后续追踪信息...">${escapeHtml(
          issue.note || ""
        )}</textarea>
      </label>
    `
  );

  container.querySelectorAll("[data-review-action]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reviewAction === issue.reviewStatus);
    button.addEventListener("click", () => {
      issue.reviewStatus = button.dataset.reviewAction;
      state.selectedIssueId = issue.id;
      renderIssues();
      drawCanvas();
      focusIssue(issue);
    });
  });

  const noteInput = container.querySelector(".issue-note-input");
  noteInput?.addEventListener("input", (event) => {
    issue.note = event.target.value;
  });
}

function renderAssetPreview(container, image, kind, issue = null) {
  if (!container) {
    return;
  }

  if (!image) {
    setText(container, "等待上传截图");
    return;
  }

  if (!issue) {
    setHTML(
      container,
      `<strong>${image.width} × ${image.height}</strong><span>${image.fileName}</span>`
    );
    return;
  }

  const crop = getIssueCropBox(issue.bbox, image.width, image.height);
  const previewCanvas = document.createElement("canvas");
  const previewContext = previewCanvas.getContext("2d");
  const outputWidth = 240;
  const aspectRatio = crop.height / Math.max(crop.width, 1);
  const outputHeight = Math.max(160, Math.round(outputWidth * aspectRatio));

  previewCanvas.width = outputWidth;
  previewCanvas.height = outputHeight;
  previewCanvas.className = "asset-preview-canvas";

  previewContext.imageSmoothingEnabled = true;
  previewContext.fillStyle = "#081020";
  previewContext.fillRect(0, 0, outputWidth, outputHeight);
  previewContext.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    outputWidth,
    outputHeight
  );
  previewContext.strokeStyle = severityColor(issue.severity);
  previewContext.lineWidth = 3;
  previewContext.strokeRect(1.5, 1.5, outputWidth - 3, outputHeight - 3);

  const metaLabel = kind === "design" ? "设计稿局部" : "开发稿局部";
  const wrapper = document.createElement("div");
  wrapper.className = "asset-preview-detail";

  const chip = document.createElement("span");
  chip.className = "asset-preview-chip";
  chip.textContent = metaLabel;

  const caption = document.createElement("div");
  caption.className = "asset-preview-caption";
  caption.innerHTML = `
    <strong>${issue.title}</strong>
    <span>${crop.width} × ${crop.height} · ${image.fileName}</span>
  `;

  setHTML(container, "");
  container.appendChild(chip);
  container.appendChild(previewCanvas);
  container.appendChild(caption);
}

function getIssueCropBox(bbox, maxWidth, maxHeight) {
  const paddingX = Math.max(24, Math.round(bbox.width * 0.35));
  const paddingY = Math.max(24, Math.round(bbox.height * 0.35));
  const x = clamp(bbox.x - paddingX, 0, maxWidth - 1);
  const y = clamp(bbox.y - paddingY, 0, maxHeight - 1);
  const width = clamp(bbox.width + paddingX * 2, 32, maxWidth - x);
  const height = clamp(bbox.height + paddingY * 2, 32, maxHeight - y);
  return { x, y, width, height };
}

function handleCanvasTouchStart(event) {
  if (event.touches.length !== 2 || !canvas.width || !canvas.height) {
    return;
  }

  event.preventDefault();

  const midpoint = getTouchMidpoint(event.touches);
  const canvasRect = canvas.getBoundingClientRect();
  touchZoomState.active = true;
  touchZoomState.startDistance = getTouchDistance(event.touches);
  touchZoomState.startZoom = state.zoomLevel;
  touchZoomState.anchorCanvasX = clamp(
    ((midpoint.x - canvasRect.left) / Math.max(canvasRect.width, 1)) * canvas.width,
    0,
    canvas.width
  );
  touchZoomState.anchorCanvasY = clamp(
    ((midpoint.y - canvasRect.top) / Math.max(canvasRect.height, 1)) * canvas.height,
    0,
    canvas.height
  );
}

function handleCanvasTouchMove(event) {
  if (!touchZoomState.active || event.touches.length !== 2) {
    return;
  }

  event.preventDefault();

  const distance = getTouchDistance(event.touches);
  if (distance <= 0 || !touchZoomState.startDistance) {
    return;
  }

  const midpoint = getTouchMidpoint(event.touches);
  state.zoomLevel = clamp(touchZoomState.startZoom * (distance / touchZoomState.startDistance), 0.25, 6);
  applyCanvasScale();
  preserveCanvasAnchor(midpoint.x, midpoint.y);
}

function handleCanvasTouchEnd(event) {
  if (event.touches.length < 2) {
    touchZoomState.active = false;
    touchZoomState.startDistance = 0;
  }
}

function getTouchDistance(touches) {
  const [first, second] = touches;
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function getTouchMidpoint(touches) {
  const [first, second] = touches;
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function preserveCanvasAnchor(viewportX, viewportY) {
  const canvasRect = canvas.getBoundingClientRect();
  const renderedX = canvasRect.left + (touchZoomState.anchorCanvasX / canvas.width) * canvasRect.width;
  const renderedY = canvasRect.top + (touchZoomState.anchorCanvasY / canvas.height) * canvasRect.height;
  canvasScroll.scrollLeft += renderedX - viewportX;
  canvasScroll.scrollTop += renderedY - viewportY;
}

function setStatus(message, tone) {
  if (!statusBanner) {
    return;
  }

  statusBanner.className = `status-banner ${tone}`;
  setText(statusBanner, message);
}

function getImageData(image) {
  const offscreen = document.createElement("canvas");
  const offscreenContext = offscreen.getContext("2d", { willReadFrequently: true });
  offscreen.width = image.width;
  offscreen.height = image.height;
  offscreenContext.filter = "contrast(1.02) saturate(1.02) blur(0.6px)";
  offscreenContext.drawImage(image, 0, 0);
  return offscreenContext.getImageData(0, 0, image.width, image.height);
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      image.fileName = file.name;
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`无法读取图片: ${file.name}`));
    };
    image.src = objectUrl;
  });
}

function buildMetaText(image) {
  return `${image.fileName} · ${image.width} × ${image.height}`;
}

function typeLabel(type) {
  return (
    {
      color: "颜色",
      font_size: "字号",
      radius: "圆角",
      spacing: "间距",
      alignment: "对齐",
    }[type] ?? type
  );
}

function severityLabel(severity) {
  return (
    {
      high: "高",
      medium: "中",
      low: "低",
    }[severity] ?? severity
  );
}

function severityColor(severity) {
  return (
    {
      high: "#e04f4f",
      medium: "#ea9d2b",
      low: "#2f8f6b",
    }[severity] ?? "#d3622b"
  );
}

function fitCanvasToViewport() {
  if (!canvas.width || !canvas.height) {
    return;
  }

  const styles = window.getComputedStyle(canvasScroll);
  const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
  const availableWidth = Math.max(canvasScroll.clientWidth - horizontalPadding, 240);
  const availableHeight = Math.max(canvasScroll.clientHeight - verticalPadding, 220);
  state.fitScale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height, 1);
  applyCanvasScale();
}

function applyCanvasScale() {
  if (!canvas.width || !canvas.height) {
    return;
  }

  const scale = clamp((state.fitScale || 1) * (state.zoomLevel || 1), 0.25, 6);
  state.displayScale = scale;
  canvas.style.width = `${Math.round(canvas.width * scale)}px`;
  canvas.style.height = `${Math.round(canvas.height * scale)}px`;
  updateZoomLabel();
}

function updateZoomLabel() {
  setText(zoomResetButton, `${Math.round((state.zoomLevel || 1) * 100)}%`);
}

function formatMetric(value, digits) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  return Number(value).toFixed(digits);
}

function formatSignedMetric(value, digits) {
  if (!Number.isFinite(value)) {
    return "--";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${Number(value).toFixed(digits)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
