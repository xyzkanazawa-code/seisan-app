/**
 * 画像処理ユーティリティ (純粋HTML5 Canvas API / クライアント完全ローカル)
 * - レシート枠切り出し
 * - 明るさ・コントラスト自動強調（暗所・薄い感熱紙対策）
 * - インボイスT番号の黄色蛍光ペン風ハイライト合成（アルファ値30%）
 * - ETC明細画像の縦分割クロップ
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 画像要素をロードするプロミス
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

/**
 * 暗所・感熱紙用の自動コントラスト＆適応露出補正
 * （写真のプレビュー・保存用：鮮明で見やすいレシート画像に仕上げる）
 */
export async function enhanceReceiptImage(imageSrc: string): Promise<string> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');

  // 長辺を最大 1800px に適応リサイズ（メモリ負荷軽減と描画シャープネスの最適化）
  const maxDim = 1800;
  let targetWidth = img.width;
  let targetHeight = img.height;
  if (Math.max(img.width, img.height) > maxDim) {
    const scale = maxDim / Math.max(img.width, img.height);
    targetWidth = Math.round(img.width * scale);
    targetHeight = Math.round(img.height * scale);
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageSrc;

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // ピクセルデータ取得
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  // 平均輝度と輝度分布の算出
  let totalBrightness = 0;
  let sampleCount = 0;
  let minBrightness = 255;
  let maxBrightness = 0;

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    totalBrightness += brightness;
    sampleCount++;
    if (brightness < minBrightness) minBrightness = brightness;
    if (brightness > maxBrightness) maxBrightness = brightness;
  }

  const avgBrightness = sampleCount > 0 ? totalBrightness / sampleCount : 128;

  // 暗所補正（平均輝度が130未満の場合、ガンマ補正で明るさを自動引き上げ）
  const gamma = avgBrightness < 80 ? 0.55 : avgBrightness < 130 ? 0.75 : 1.0;
  const range = Math.max(10, maxBrightness - minBrightness);

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let val = data[i + c];
      // ヒストグラムストレッチ
      val = ((val - minBrightness) / range) * 255;
      val = Math.min(255, Math.max(0, val));
      // ガンマ補正で暗部・中間調を持ち上げる
      if (gamma !== 1.0) {
        val = Math.pow(val / 255, gamma) * 255;
      }
      data[i + c] = Math.min(255, Math.max(0, Math.round(val)));
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.90);
}

/**
 * OCR認識（Tesseract）専用の高コントラスト・輪郭強調画像生成
 * 感熱紙の薄い印字やパーキングチケットのドット文字を黒白クッキリに変換
 */
export async function prepareImageForOcr(imageSrc: string): Promise<string> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');

  // OCR認識に最適なサイズ（長辺 1600px）
  const maxDim = 1600;
  let targetWidth = img.width;
  let targetHeight = img.height;
  if (Math.max(img.width, img.height) > maxDim) {
    const scale = maxDim / Math.max(img.width, img.height);
    targetWidth = Math.round(img.width * scale);
    targetHeight = Math.round(img.height * scale);
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageSrc;

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  // 1. グレースケール化と輝度計算
  const gray: number[] = new Array(data.length / 4);
  let totalGray = 0;
  for (let i = 0; i < data.length; i += 4) {
    const g = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    gray[i / 4] = g;
    totalGray += g;
  }
  const meanGray = totalGray / gray.length;

  // 2. 文字と背景のコントラストを強力に引き伸ばす（ソフト二値化）
  // 閾値付近の境界を鋭角化し、文字をハッキリ浮き彫りにする
  const threshold = Math.max(90, Math.min(180, meanGray * 0.92));

  for (let i = 0; i < gray.length; i++) {
    const g = gray[i];
    // シグモイド調の急峻なコントラスト
    let val: number;
    if (g < threshold) {
      val = Math.max(0, g * 0.4); // 暗い文字をより黒く
    } else {
      val = Math.min(255, 200 + (g - threshold) * 1.5); // 明るい背景を白く
    }

    const idx = i * 4;
    data[idx] = val;
    data[idx + 1] = val;
    data[idx + 2] = val;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/**
 * インボイス登録番号のバウンディングボックスに
 * 仕様書指定の「半透明（アルファ値30%）の黄色ハイライトマスク」を描画
 */
export async function applyInvoiceHighlight(
  imageSrc: string,
  box?: BoundingBox
): Promise<string> {
  const img = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return imageSrc;

  // 元画像を描画
  ctx.drawImage(img, 0, 0);

  // バウンディングボックスが渡された場合、その位置に描画
  // 渡されない場合は、レシート上部〜中段の一般的なT番号記載エリアに描画
  const targetBox: BoundingBox = box || {
    x: Math.round(canvas.width * 0.08),
    y: Math.round(canvas.height * 0.18),
    width: Math.round(canvas.width * 0.84),
    height: Math.max(28, Math.round(canvas.height * 0.055))
  };

  // 蛍光ペン風エフェクト（乗算・アルファ30%の黄色）
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgba(255, 235, 59, 0.30)'; // 仕様書準拠：黄色、アルファ30%

  // 蛍光ペンらしい角丸・少しゆったりした矩形
  const radius = 6;
  const padX = 6;
  const padY = 4;
  const hx = Math.max(0, targetBox.x - padX);
  const hy = Math.max(0, targetBox.y - padY);
  const hw = Math.min(canvas.width - hx, targetBox.width + padX * 2);
  const hh = Math.min(canvas.height - hy, targetBox.height + padY * 2);

  ctx.beginPath();
  ctx.roundRect(hx, hy, hw, hh, radius);
  ctx.fill();

  // マーカーの縁に極薄いアンバー色のアクセントライン（視認性向上）
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.40)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.88);
}

/**
 * ETC利用証明書の長尺レシートを、区間（スライス）ごとにクロップ分割
 */
export async function sliceEtcReceipt(
  imageSrc: string,
  slicesCount: number
): Promise<string[]> {
  if (slicesCount <= 1) return [imageSrc];

  const img = await loadImage(imageSrc);
  const slicedDataUrls: string[] = [];
  const sliceHeight = Math.floor(img.height / slicesCount);

  for (let i = 0; i < slicesCount; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = sliceHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    // ソース画像から縦方向にスライス
    ctx.drawImage(
      img,
      0,
      i * sliceHeight,
      img.width,
      sliceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    slicedDataUrls.push(canvas.toDataURL('image/jpeg', 0.85));
  }

  return slicedDataUrls;
}

/**
 * 縦の比率配列（または均等分割）に基づいて画像を縦方向にスライス分割する
 */
export async function sliceImageVerticalSegments(
  imageSrc: string,
  segments: { topPct: number; bottomPct: number }[]
): Promise<string[]> {
  if (!segments || segments.length <= 1) return [imageSrc];

  try {
    const img = await loadImage(imageSrc);
    const origW = img.width;
    const origH = img.height;
    const results: string[] = [];

    for (const seg of segments) {
      const topY = Math.max(0, Math.min(origH - 10, Math.round(origH * Math.max(0, seg.topPct))));
      const bottomY = Math.min(origH, Math.max(topY + 10, Math.round(origH * Math.min(1, seg.bottomPct))));
      const segH = bottomY - topY;

      const canvas = document.createElement('canvas');
      canvas.width = origW;
      canvas.height = segH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.drawImage(img, 0, topY, origW, segH, 0, 0, origW, segH);
      results.push(canvas.toDataURL('image/jpeg', 0.88));
    }

    return results.length > 0 ? results : [imageSrc];
  } catch (err) {
    console.warn('画像縦分割エラー:', err);
    return [imageSrc];
  }
}

/**
 * 複数枚一括撮影時の画像から、レシート候補枠を検出して個別に切り抜く
 * （白または明るい矩形領域のセグメンテーション＆輪郭オートクロップ）
 * - 複数枚並べて撮影した場合は、それぞれのレシート画像配列を返す
 * - 1枚だけ撮影した場合でも、周囲の余計な机や余白を切り落としてレシート本体に自動トリミング
 */
export async function cropReceiptRegions(imageSrc: string): Promise<string[]> {
  try {
    const img = await loadImage(imageSrc);
    const origW = img.width;
    const origH = img.height;

    // 高速解析用ダウンサンプリング（幅480px基準）
    const scanW = 480;
    const scale = scanW / origW;
    const scanH = Math.max(1, Math.round(origH * scale));

    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = scanW;
    scanCanvas.height = scanH;
    const scanCtx = scanCanvas.getContext('2d');
    if (!scanCtx) return [imageSrc];

    scanCtx.drawImage(img, 0, 0, scanW, scanH);
    const imgData = scanCtx.getImageData(0, 0, scanW, scanH);
    const data = imgData.data;

    // 1. グレースケール化と平均輝度の計算
    const totalPixels = scanW * scanH;
    const gray = new Uint8Array(totalPixels);
    let sumBrightness = 0;

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const g = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
      gray[i] = g;
      sumBrightness += g;
    }

    const meanBrightness = sumBrightness / totalPixels;

    // 2. レシート（白地・高輝度領域）の二値化閾値
    // 背景（机・シート等）とレシート（白紙）の分離
    const threshold = Math.max(105, Math.min(220, meanBrightness + 18));
    const binary = new Uint8Array(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      binary[i] = gray[i] >= threshold ? 1 : 0;
    }

    // 3. モルフォロジー膨張（文字の隙間や折れ目を埋めて1つの白い塊にする）
    const dilated = new Uint8Array(totalPixels);
    const pad = 3; // 膨張カーネル半径
    for (let y = pad; y < scanH - pad; y += 2) {
      for (let x = pad; x < scanW - pad; x += 2) {
        if (binary[y * scanW + x] === 1) {
          for (let dy = -pad; dy <= pad; dy++) {
            for (let dx = -pad; dx <= pad; dx++) {
              dilated[(y + dy) * scanW + (x + dx)] = 1;
            }
          }
        }
      }
    }

    // 4. 簡易連結成分クラスタリング（グリッドスキャンと外接矩形マージ）
    const visited = new Uint8Array(totalPixels);
    const rawBoxes: BoundingBox[] = [];

    const minArea = totalPixels * 0.025; // 画面の2.5%以上（ノイズ除去）
    const maxArea = totalPixels * 0.94; // 画面全体の94%以下

    for (let y = 5; y < scanH - 5; y += 6) {
      for (let x = 5; x < scanW - 5; x += 6) {
        const pIdx = y * scanW + x;
        if (dilated[pIdx] === 1 && visited[pIdx] === 0) {
          // BFSでこの白い塊の境界を探索
          let minBx = x;
          let maxBx = x;
          let minBy = y;
          let maxBy = y;
          let pixelCount = 0;

          const queue: number[] = [x, y];
          visited[pIdx] = 1;

          while (queue.length > 0) {
            const cy = queue.pop()!;
            const cx = queue.pop()!;
            pixelCount++;

            if (cx < minBx) minBx = cx;
            if (cx > maxBx) maxBx = cx;
            if (cy < minBy) minBy = cy;
            if (cy > maxBy) maxBy = cy;

            // 4近傍をステップ走査（高速化のため4px刻み）
            const step = 4;
            const neighbors = [
              [cx + step, cy],
              [cx - step, cy],
              [cx, cy + step],
              [cx, cy - step]
            ];

            for (const [nx, ny] of neighbors) {
              if (nx >= 0 && nx < scanW && ny >= 0 && ny < scanH) {
                const nIdx = ny * scanW + nx;
                if (dilated[nIdx] === 1 && visited[nIdx] === 0) {
                  visited[nIdx] = 1;
                  queue.push(nx, ny);
                }
              }
            }
          }

          const bw = maxBx - minBx;
          const bh = maxBy - minBy;
          const area = bw * bh;

          // アスペクト比チェック（極端な帯状の光沢などは除外）
          const aspect = bw / bh;
          if (area >= minArea && area <= maxArea && aspect > 0.15 && aspect < 6.5) {
            rawBoxes.push({
              x: minBx,
              y: minBy,
              width: bw,
              height: bh
            });
          }
        }
      }
    }

    // 5. 重なっている枠の統合（Non-Maximum Merging）
    const mergedBoxes: BoundingBox[] = [];
    for (const b of rawBoxes) {
      let isMerged = false;
      for (let i = 0; i < mergedBoxes.length; i++) {
        const m = mergedBoxes[i];
        // 重なり判定
        const overlapX = Math.max(0, Math.min(b.x + b.width, m.x + m.width) - Math.max(b.x, m.x));
        const overlapY = Math.max(0, Math.min(b.y + b.height, m.y + m.height) - Math.max(b.y, m.y));
        const overlapArea = overlapX * overlapY;

        if (overlapArea > 0.15 * Math.min(b.width * b.height, m.width * m.height)) {
          // 統合
          const newX = Math.min(b.x, m.x);
          const newY = Math.min(b.y, m.y);
          const newR = Math.max(b.x + b.width, m.x + m.width);
          const newB = Math.max(b.y + b.height, m.y + m.height);
          mergedBoxes[i] = {
            x: newX,
            y: newY,
            width: newR - newX,
            height: newB - newY
          };
          isMerged = true;
          break;
        }
      }
      if (!isMerged) {
        mergedBoxes.push(b);
      }
    }

    // 6. 有効なレシート枠がない場合は元画像にautoTightCropをかけて余白を削ぎ落とす
    if (mergedBoxes.length === 0) {
      const tight = await autoTightCrop(imageSrc);
      return [tight];
    }

    // 7. 画面上部から下部、左から右へ並び替え
    mergedBoxes.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 40) return a.y - b.y;
      return a.x - b.x;
    });

    // 8. ほぼ同じY座標帯（1枚の長いETC明細やレシートが文字や折り目で上下or左右に細切れになったケース）や、
    //    全体面積の8%未満しかない小さなノイズ断片を除去し、本来のレシート領域に統合する
    const significantBoxes = mergedBoxes.filter((b) => b.width * b.height >= totalPixels * 0.04);
    const targetBoxes = significantBoxes.length > 0 ? significantBoxes : mergedBoxes;

    // もし複数ボックスが検出されたが、X方向が大きく重なっていて縦に並んでいる場合（1枚のレシートが上下に分断された場合）は1つに結合する
    const consolidatedBoxes: BoundingBox[] = [];
    for (const box of targetBoxes) {
      let combined = false;
      for (let i = 0; i < consolidatedBoxes.length; i++) {
        const c = consolidatedBoxes[i];
        const overlapX = Math.max(0, Math.min(box.x + box.width, c.x + c.width) - Math.max(box.x, c.x));
        const minW = Math.min(box.width, c.width);
        const verticalGap = Math.max(box.y - (c.y + c.height), c.y - (box.y + box.height));
        // 横幅の50%以上が重なり、縦の隙間が画面高の12%以内なら同一レシートとみなして結合
        if (overlapX >= minW * 0.5 && verticalGap <= scanH * 0.12) {
          const nx = Math.min(box.x, c.x);
          const ny = Math.min(box.y, c.y);
          const nr = Math.max(box.x + box.width, c.x + c.width);
          const nb = Math.max(box.y + box.height, c.y + c.height);
          consolidatedBoxes[i] = { x: nx, y: ny, width: nr - nx, height: nb - ny };
          combined = true;
          break;
        }
      }
      if (!combined) {
        consolidatedBoxes.push(box);
      }
    }

    // 9. 各レシート枠を元画像からクロップ（余白を最小限の1.5%にしてタイトに切り出す）
    const croppedResults: string[] = [];
    const invScale = 1 / scale;

    for (const box of consolidatedBoxes) {
      // 余分な机や背景が入らないよう最小限のマージン（1.5%）
      const padX = Math.round(box.width * 0.015);
      const padY = Math.round(box.height * 0.015);

      const cropX = Math.max(0, Math.round((box.x - padX) * invScale));
      const cropY = Math.max(0, Math.round((box.y - padY) * invScale));
      const cropW = Math.min(origW - cropX, Math.round((box.width + padX * 2) * invScale));
      const cropH = Math.min(origH - cropY, Math.round((box.height + padY * 2) * invScale));

      // 極小の場合はスキップ
      if (cropW < 100 || cropH < 100) continue;

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) continue;

      cropCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      const pieceDataUrl = cropCanvas.toDataURL('image/jpeg', 0.92);

      // さらに切り出した断片に対しても外周余白をタイトにトリミング
      const tightenedPiece = await autoTightCrop(pieceDataUrl);
      croppedResults.push(tightenedPiece);
    }

    return croppedResults.length > 0 ? croppedResults : [await autoTightCrop(imageSrc)];
  } catch (err) {
    console.warn('レシート自動クロップ例外発生。元画像を使用:', err);
    return [imageSrc];
  }
}

/**
 * レシート・領収書画像の周囲にある余分な背景余白（机、影、マット、黒い台など）を自動検出し、
 * レシート紙本体の縁（エッジ）に合わせてタイトにトリミングする
 */
export async function autoTightCrop(imageSrc: string): Promise<string> {
  try {
    const img = await loadImage(imageSrc);
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    if (origW < 60 || origH < 60) return imageSrc;

    // 解析用キャンバス（長辺最大 600px に適応リサイズして高速・安定検出）
    const maxDim = 600;
    const scale = Math.min(1, maxDim / Math.max(origW, origH));
    const scanW = Math.max(1, Math.round(origW * scale));
    const scanH = Math.max(1, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = scanW;
    canvas.height = scanH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageSrc;

    ctx.drawImage(img, 0, 0, scanW, scanH);
    const imgData = ctx.getImageData(0, 0, scanW, scanH);
    const data = imgData.data;

    // 1. 中央領域（レシート紙が確実に存在するエリア）の輝度分布をサンプリングし、
    //    照明グラデーションに惑わされない「レシート紙の白さ（上位輝度）」と「外周背景の輝度」を比較する
    const centerBrList: number[] = [];
    const cyStart = Math.floor(scanH * 0.2);
    const cyEnd = Math.ceil(scanH * 0.8);
    const cxStart = Math.floor(scanW * 0.2);
    const cxEnd = Math.ceil(scanW * 0.8);

    for (let y = cyStart; y < cyEnd; y += 2) {
      for (let x = cxStart; x < cxEnd; x += 2) {
        const i = (y * scanW + x) * 4;
        const br = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        centerBrList.push(br);
      }
    }
    centerBrList.sort((a, b) => a - b);
    // レシート紙の代表的な明るさ（中央領域の75パーセンタイル）
    const paperBrightness =
      centerBrList.length > 0 ? centerBrList[Math.floor(centerBrList.length * 0.75)] : 200;

    // 外周縁（上下左右の端3%）の平均輝度・彩度を計算
    let borderBrSum = 0;
    let borderCount = 0;
    const edgeBandX = Math.max(2, Math.floor(scanW * 0.04));
    const edgeBandY = Math.max(2, Math.floor(scanH * 0.04));

    for (let y = 0; y < scanH; y += 2) {
      for (let x = 0; x < scanW; x += 2) {
        if (x < edgeBandX || x >= scanW - edgeBandX || y < edgeBandY || y >= scanH - edgeBandY) {
          const i = (y * scanW + x) * 4;
          const br = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
          borderBrSum += br;
          borderCount++;
        }
      }
    }
    const bgBrightness = borderCount > 0 ? borderBrSum / borderCount : 90;

    // レシート紙と背景の中間閾値（カメラの周辺減光や机のグラデーションでも背景を紙と誤認しないよう高めに設定）
    const adaptiveWhiteThreshold = Math.max(
      145,
      Math.min(225, bgBrightness + (paperBrightness - bgBrightness) * 0.58)
    );

    // 2. ピクセルごとの「レシート紙らしさ」の判定
    const isForeground = new Uint8Array(scanW * scanH);
    for (let y = 0; y < scanH; y++) {
      for (let x = 0; x < scanW; x++) {
        const i = (y * scanW + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const br = (r * 299 + g * 587 + b * 114) / 1000;
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;

        // 木目机・茶色や青のマット（高彩度）を除外し、白い感熱紙・領収書用紙（高輝度＆低彩度）を検出
        const isPaper = br >= adaptiveWhiteThreshold && saturation < 0.32;
        if (isPaper) {
          isForeground[y * scanW + x] = 1;
        }
      }
    }

    // 3. 上下左右からの走査（行・列ごとの紙ピクセル占有率チェック）
    // ノイズに反応しないよう、連続した行/列で 15% 以上の紙ピクセルが現れる位置をレシート端とする
    const thresholdRatio = 0.15;
    const reqPixelsX = Math.max(6, Math.round(scanW * thresholdRatio));

    let top = 0;
    for (let y = 0; y < scanH - 2; y++) {
      let count = 0;
      let countNext = 0;
      for (let x = 0; x < scanW; x++) {
        if (isForeground[y * scanW + x] === 1) count++;
        if (isForeground[(y + 1) * scanW + x] === 1) countNext++;
      }
      if (count >= reqPixelsX && countNext >= reqPixelsX) {
        top = y;
        break;
      }
    }

    let bottom = scanH - 1;
    for (let y = scanH - 1; y >= 2; y--) {
      let count = 0;
      let countPrev = 0;
      for (let x = 0; x < scanW; x++) {
        if (isForeground[y * scanW + x] === 1) count++;
        if (isForeground[(y - 1) * scanW + x] === 1) countPrev++;
      }
      if (count >= reqPixelsX && countPrev >= reqPixelsX) {
        bottom = y;
        break;
      }
    }

    let left = 0;
    for (let x = 0; x < scanW - 2; x++) {
      let count = 0;
      let countNext = 0;
      for (let y = top; y <= bottom; y++) {
        if (isForeground[y * scanW + x] === 1) count++;
        if (isForeground[y * scanW + (x + 1)] === 1) countNext++;
      }
      const spanH = Math.max(1, bottom - top + 1);
      const reqY = Math.max(6, Math.round(spanH * thresholdRatio));
      if (count >= reqY && countNext >= reqY) {
        left = x;
        break;
      }
    }

    let right = scanW - 1;
    for (let x = scanW - 1; x >= 2; x--) {
      let count = 0;
      let countPrev = 0;
      for (let y = top; y <= bottom; y++) {
        if (isForeground[y * scanW + x] === 1) count++;
        if (isForeground[y * scanW + (x - 1)] === 1) countPrev++;
      }
      const spanH = Math.max(1, bottom - top + 1);
      const reqY = Math.max(6, Math.round(spanH * thresholdRatio));
      if (count >= reqY && countPrev >= reqY) {
        right = x;
        break;
      }
    }

    // 4. 境界の妥当性検証
    const cropWScan = right - left;
    const cropHScan = bottom - top;

    // もし検出結果が小さすぎる（画面の10%未満）や逆転している場合はトリミングを行わない
    if (cropWScan < scanW * 0.10 || cropHScan < scanH * 0.10 || cropWScan <= 0 || cropHScan <= 0) {
      return imageSrc;
    }

    // もしすでに画面の98%以上を占めている場合でも、手動で「余白を自動カット」を押したときに
    // 外周の微細なフチ（各辺2.5%）をスッキリ削ぎ落とせるようにする
    if (cropWScan >= scanW * 0.98 && cropHScan >= scanH * 0.98) {
      return cropImageWithInsets(imageSrc, { top: 0.025, bottom: 0.025, left: 0.025, right: 0.025 });
    }

    // 5. 元画像座標へ逆変換し、0.8%の微細な安全マージンを付加
    const invScale = 1 / scale;
    const marginX = Math.round(origW * 0.008);
    const marginY = Math.round(origH * 0.008);

    const origCropX = Math.max(0, Math.round(left * invScale) - marginX);
    const origCropY = Math.max(0, Math.round(top * invScale) - marginY);
    const origCropW = Math.min(origW - origCropX, Math.round(cropWScan * invScale) + marginX * 2);
    const origCropH = Math.min(origH - origCropY, Math.round(cropHScan * invScale) + marginY * 2);

    if (origCropW < 50 || origCropH < 50) return imageSrc;

    // 6. 元画像からタイトに切り出し
    const outCanvas = document.createElement('canvas');
    outCanvas.width = origCropW;
    outCanvas.height = origCropH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return imageSrc;

    outCtx.drawImage(img, origCropX, origCropY, origCropW, origCropH, 0, 0, origCropW, origCropH);
    return outCanvas.toDataURL('image/jpeg', 0.92);
  } catch (err) {
    console.warn('余白自動トリミングエラー:', err);
    return imageSrc;
  }
}

/**
 * 手動切り取り用：指定した上下左右の切り落とし余白比率（0.0 〜 0.88）で確実にトリミング
 * 上＋下、左＋右の合計が92%を超える場合も安全に比率調整して極小のETC明細や小領収書まで自在に切り取れる
 */
export async function cropImageWithInsets(
  imageSrc: string,
  insets: { top: number; bottom: number; left: number; right: number }
): Promise<string> {
  try {
    const img = await loadImage(imageSrc);
    const origW = img.naturalWidth || img.width;
    const origH = img.naturalHeight || img.height;

    if (!origW || !origH) return imageSrc;

    const clampSingle = (val: number) => Math.max(0, Math.min(0.88, Number(val) || 0));
    let topPct = clampSingle(insets.top);
    let bottomPct = clampSingle(insets.bottom);
    let leftPct = clampSingle(insets.left);
    let rightPct = clampSingle(insets.right);

    // 全て0の場合は切り取り不要
    if (topPct === 0 && bottomPct === 0 && leftPct === 0 && rightPct === 0) {
      return imageSrc;
    }

    // 上下の合計が 0.92（残り8%）を超える場合は比率を保ってクランプ
    const maxTotalCrop = 0.92;
    if (topPct + bottomPct > maxTotalCrop) {
      const scaleY = maxTotalCrop / (topPct + bottomPct);
      topPct *= scaleY;
      bottomPct *= scaleY;
    }
    if (leftPct + rightPct > maxTotalCrop) {
      const scaleX = maxTotalCrop / (leftPct + rightPct);
      leftPct *= scaleX;
      rightPct *= scaleX;
    }

    const cropX = Math.round(origW * leftPct);
    const cropY = Math.round(origH * topPct);
    const cropW = Math.max(24, Math.round(origW * (1 - leftPct - rightPct)));
    const cropH = Math.max(24, Math.round(origH * (1 - topPct - bottomPct)));

    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageSrc;

    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch (err) {
    console.warn('手動切り取りエラー:', err);
    return imageSrc;
  }
}

