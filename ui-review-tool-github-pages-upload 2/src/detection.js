(() => {
const COLOR_MATRIX = [0.2126, 0.7152, 0.0722];

function analyzeImages(designImageData, devImageData) {
  const width = designImageData.width;
  const height = designImageData.height;

  if (width !== devImageData.width || height !== devImageData.height) {
    throw new Error("截图尺寸不一致，无法比对。");
  }

  const diffMap = buildDiffMap(designImageData.data, devImageData.data, width, height);
  const candidates = findCandidateRegions(diffMap, width, height);

  return candidates
    .map((bbox, index) => classifyRegion(index, bbox, designImageData, devImageData))
    .filter(Boolean)
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.confidence - a.confidence);
}

function buildDiffMap(designPixels, devPixels, width, height) {
  const blockSize = Math.max(6, Math.round(Math.min(width, height) / 80));
  const mapWidth = Math.ceil(width / blockSize);
  const mapHeight = Math.ceil(height / blockSize);
  const values = new Float32Array(mapWidth * mapHeight);

  for (let by = 0; by < mapHeight; by += 1) {
    for (let bx = 0; bx < mapWidth; bx += 1) {
      let total = 0;
      let count = 0;
      for (let y = by * blockSize; y < Math.min(height, (by + 1) * blockSize); y += 1) {
        for (let x = bx * blockSize; x < Math.min(width, (bx + 1) * blockSize); x += 1) {
          const offset = (y * width + x) * 4;
          const dr = Math.abs(designPixels[offset] - devPixels[offset]);
          const dg = Math.abs(designPixels[offset + 1] - devPixels[offset + 1]);
          const db = Math.abs(designPixels[offset + 2] - devPixels[offset + 2]);
          total += (dr + dg + db) / 3;
          count += 1;
        }
      }
      values[by * mapWidth + bx] = total / Math.max(count, 1);
    }
  }

  return { values, mapWidth, mapHeight, blockSize };
}

function findCandidateRegions(diffMap, width, height) {
  const { values, mapWidth, mapHeight, blockSize } = diffMap;
  const mask = new Uint8Array(values.length);
  const threshold = adaptiveThreshold(values);

  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= threshold) {
      mask[index] = 1;
    }
  }

  const visited = new Uint8Array(values.length);
  const candidates = [];

  for (let y = 0; y < mapHeight; y += 1) {
    for (let x = 0; x < mapWidth; x += 1) {
      const index = y * mapWidth + x;
      if (!mask[index] || visited[index]) {
        continue;
      }

      const queue = [index];
      visited[index] = 1;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let energy = 0;
      let cells = 0;

      while (queue.length) {
        const current = queue.pop();
        const cx = current % mapWidth;
        const cy = Math.floor(current / mapWidth);
        energy += values[current];
        cells += 1;
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);

        for (const [dx, dy] of ADJACENT) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) {
            continue;
          }
          const nextIndex = ny * mapWidth + nx;
          if (!mask[nextIndex] || visited[nextIndex]) {
            continue;
          }
          visited[nextIndex] = 1;
          queue.push(nextIndex);
        }
      }

      const pixelWidth = (maxX - minX + 1) * blockSize;
      const pixelHeight = (maxY - minY + 1) * blockSize;
      const area = pixelWidth * pixelHeight;

      if (cells < 2 || area < 250) {
        continue;
      }

      candidates.push({
        x: clamp(minX * blockSize - blockSize, 0, width),
        y: clamp(minY * blockSize - blockSize, 0, height),
        width: clamp(pixelWidth + blockSize * 2, blockSize, width),
        height: clamp(pixelHeight + blockSize * 2, blockSize, height),
        energy: energy / cells,
      });
    }
  }

  return mergeSimilarRegions(candidates, width, height).slice(0, 24);
}

function classifyRegion(index, bbox, designImageData, devImageData) {
  const metrics = measureRegion(bbox, designImageData, devImageData);

  if (metrics.area < 240) {
    return null;
  }

  const { colorDelta, brightnessDelta, edgeDelta, horizontalShift, verticalShift, cornerDelta, textLike } = metrics;
  let type = "color";
  let title = "颜色存在明显偏差";
  let description = `该区域平均色差约 ${Math.round(colorDelta)}，建议检查主色、背景色或边框色是否与设计稿一致。`;

  if (cornerDelta > 0.18 && metrics.rectLike) {
    type = "radius";
    title = "圆角表现不一致";
    description = `检测到角部形态差异，开发稿角部覆盖率变化约 ${Math.round(cornerDelta * 100)}%，建议检查组件圆角。`;
  } else if (textLike && Math.abs(edgeDelta) > 0.16 && Math.abs(brightnessDelta) > 7) {
    type = "font_size";
    title = "字号或文本块密度异常";
    description = "该区域呈现文本特征，行高或字面密度和设计稿差异明显，建议检查字号、字重与行高。";
  } else if (Math.abs(horizontalShift) > 8 || Math.abs(verticalShift) > 8) {
    type = Math.abs(horizontalShift) > 12 || Math.abs(verticalShift) > 12 ? "alignment" : "spacing";
    title = type === "alignment" ? "对齐位置存在偏移" : "间距表现不一致";
    const shiftX = Math.round(horizontalShift);
    const shiftY = Math.round(verticalShift);
    description = `区域重心偏移约 X:${shiftX}px / Y:${shiftY}px，建议检查对齐线与相邻元素间距。`;
  } else if (colorDelta > 22 || Math.abs(brightnessDelta) > 10) {
    type = "color";
    title = "颜色存在明显偏差";
    description = `该区域平均色差约 ${Math.round(colorDelta)}，亮度变化约 ${Math.round(brightnessDelta)}，建议检查配色。`;
  } else if (Math.abs(edgeDelta) > 0.11) {
    type = "spacing";
    title = "区域密度与间距不一致";
    description = "该区域边缘密度差异明显，常见于 padding、留白或内部布局间距变化。";
  } else {
    return null;
  }

  const severity = getSeverity({ colorDelta, brightnessDelta, edgeDelta, horizontalShift, verticalShift, cornerDelta });
  const confidence = clamp(
    0.45 +
      colorDelta / 120 +
      Math.abs(brightnessDelta) / 90 +
      Math.abs(edgeDelta) * 0.7 +
      (Math.abs(horizontalShift) + Math.abs(verticalShift)) / 180 +
      cornerDelta,
    0.45,
    0.99
  );

  return {
    id: `issue-${index + 1}`,
    type,
    title,
    description,
    severity,
    confidence,
    bbox: normalizeBBox(bbox, designImageData.width, designImageData.height),
    metrics,
  };
}

function measureRegion(bbox, designImageData, devImageData) {
  const width = Math.max(1, Math.floor(bbox.width));
  const height = Math.max(1, Math.floor(bbox.height));
  const startX = Math.floor(bbox.x);
  const startY = Math.floor(bbox.y);
  const endX = Math.min(designImageData.width, startX + width);
  const endY = Math.min(designImageData.height, startY + height);

  let pixelCount = 0;
  let colorSum = 0;
  let grayDesign = 0;
  let grayDev = 0;
  const designMask = new Uint8Array((endX - startX) * (endY - startY));
  const devMask = new Uint8Array((endX - startX) * (endY - startY));

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * designImageData.width + x) * 4;
      const dGray = grayscale(designImageData.data, offset);
      const vGray = grayscale(devImageData.data, offset);
      const diffR = Math.abs(designImageData.data[offset] - devImageData.data[offset]);
      const diffG = Math.abs(designImageData.data[offset + 1] - devImageData.data[offset + 1]);
      const diffB = Math.abs(designImageData.data[offset + 2] - devImageData.data[offset + 2]);
      const localIndex = (y - startY) * (endX - startX) + (x - startX);

      colorSum += (diffR + diffG + diffB) / 3;
      grayDesign += dGray;
      grayDev += vGray;
      designMask[localIndex] = dGray < 210 ? 1 : 0;
      devMask[localIndex] = vGray < 210 ? 1 : 0;
      pixelCount += 1;
    }
  }

  const designStats = maskStats(designMask, endX - startX, endY - startY);
  const devStats = maskStats(devMask, endX - startX, endY - startY);
  const edgeDesign = edgeDensity(designMask, endX - startX, endY - startY);
  const edgeDev = edgeDensity(devMask, endX - startX, endY - startY);

  return {
    area: pixelCount,
    colorDelta: colorSum / Math.max(pixelCount, 1),
    brightnessDelta: grayDev / Math.max(pixelCount, 1) - grayDesign / Math.max(pixelCount, 1),
    edgeDelta: edgeDev - edgeDesign,
    horizontalShift: devStats.centerX - designStats.centerX,
    verticalShift: devStats.centerY - designStats.centerY,
    cornerDelta: Math.abs(cornerCoverage(designMask, endX - startX, endY - startY) - cornerCoverage(devMask, endX - startX, endY - startY)),
    textLike: isTextLike(designMask, devMask, endX - startX, endY - startY),
    rectLike: isRectLike(designMask, devMask, endX - startX, endY - startY),
  };
}

function adaptiveThreshold(values) {
  let sum = 0;
  let max = 0;
  for (const value of values) {
    sum += value;
    max = Math.max(max, value);
  }
  const avg = sum / Math.max(values.length, 1);
  return Math.max(avg * 1.85, max * 0.28, 12);
}

function mergeSimilarRegions(regions, width, height) {
  const merged = [];

  for (const region of regions.sort((a, b) => b.energy - a.energy)) {
    const existing = merged.find((item) => overlapRatio(item, region) > 0.32 || distance(item, region) < 28);
    if (existing) {
      const x1 = Math.min(existing.x, region.x);
      const y1 = Math.min(existing.y, region.y);
      const x2 = Math.max(existing.x + existing.width, region.x + region.width);
      const y2 = Math.max(existing.y + existing.height, region.y + region.height);
      existing.x = x1;
      existing.y = y1;
      existing.width = Math.min(width - x1, x2 - x1);
      existing.height = Math.min(height - y1, y2 - y1);
      existing.energy = Math.max(existing.energy, region.energy);
    } else {
      merged.push({ ...region });
    }
  }

  return merged;
}

function overlapRatio(a, b) {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = x * y;
  if (!intersection) {
    return 0;
  }
  return intersection / Math.min(a.width * a.height, b.width * b.height);
}

function distance(a, b) {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return Math.hypot(ax - bx, ay - by);
}

function maskStats(mask, width, height) {
  let count = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = mask[y * width + x];
      if (!value) {
        continue;
      }
      count += 1;
      sumX += x;
      sumY += y;
    }
  }

  if (!count) {
    return { centerX: width / 2, centerY: height / 2, density: 0 };
  }

  return {
    centerX: sumX / count,
    centerY: sumY / count,
    density: count / (width * height),
  };
}

function edgeDensity(mask, width, height) {
  let edges = 0;
  let comparisons = 0;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const current = mask[y * width + x];
      edges += Math.abs(current - mask[y * width + x + 1]);
      edges += Math.abs(current - mask[(y + 1) * width + x]);
      comparisons += 2;
    }
  }
  return edges / Math.max(comparisons, 1);
}

function cornerCoverage(mask, width, height) {
  const spanX = Math.max(1, Math.floor(width * 0.2));
  const spanY = Math.max(1, Math.floor(height * 0.2));
  let filled = 0;
  let total = 0;

  const corners = [
    [0, 0],
    [width - spanX, 0],
    [0, height - spanY],
    [width - spanX, height - spanY],
  ];

  for (const [startX, startY] of corners) {
    for (let y = startY; y < startY + spanY; y += 1) {
      for (let x = startX; x < startX + spanX; x += 1) {
        const value = mask[y * width + x];
        filled += value;
        total += 1;
      }
    }
  }

  return filled / Math.max(total, 1);
}

function isTextLike(designMask, devMask, width, height) {
  const aspect = width / Math.max(height, 1);
  const density = (maskStats(designMask, width, height).density + maskStats(devMask, width, height).density) / 2;
  const edge = (edgeDensity(designMask, width, height) + edgeDensity(devMask, width, height)) / 2;
  return height < 120 && aspect > 1.2 && density > 0.03 && density < 0.48 && edge > 0.08;
}

function isRectLike(designMask, devMask, width, height) {
  const density = (maskStats(designMask, width, height).density + maskStats(devMask, width, height).density) / 2;
  const aspect = width / Math.max(height, 1);
  return density > 0.25 && density < 0.94 && aspect > 0.6 && aspect < 8;
}

function getSeverity(metrics) {
  const score =
    metrics.colorDelta / 18 +
    Math.abs(metrics.brightnessDelta) / 9 +
    Math.abs(metrics.edgeDelta) / 0.1 +
    Math.abs(metrics.horizontalShift) / 12 +
    Math.abs(metrics.verticalShift) / 12 +
    metrics.cornerDelta / 0.1;

  if (score > 6) {
    return "high";
  }
  if (score > 3.2) {
    return "medium";
  }
  return "low";
}

function severityWeight(severity) {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function normalizeBBox(bbox, maxWidth, maxHeight) {
  const x = clamp(Math.round(bbox.x), 0, maxWidth - 1);
  const y = clamp(Math.round(bbox.y), 0, maxHeight - 1);
  const width = clamp(Math.round(bbox.width), 8, maxWidth - x);
  const height = clamp(Math.round(bbox.height), 8, maxHeight - y);
  return { x, y, width, height };
}

function grayscale(pixels, offset) {
  return pixels[offset] * COLOR_MATRIX[0] + pixels[offset + 1] * COLOR_MATRIX[1] + pixels[offset + 2] * COLOR_MATRIX[2];
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const ADJACENT = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

window.UIReviewDetection = {
  analyzeImages,
};
})();
