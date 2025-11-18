// 状态与全局对象
const state = {
	image: null, // HTMLImageElement
	imageBitmap: null, // ImageBitmap（更高效绘制）
	originalBitmap: null, // 原图（用于还原）
	scale: 1,
	rotation: 0, // 支持任意角度（度）
	flipH: false,
	flipV: false,
	offsetX: 0,
	offsetY: 0,
	mode: "none", // none | crop | perspective
	cropRect: null, // {x,y,w,h} 画布坐标
	lassoPath: [], // 自由框选路径
	selectionMode: "rect", // rect | lasso
	perspectivePoints: [], // 四点 [{x,y},...]
	cvReady: false,
	settings: {
		promptExtra: "请精确识别图片中的所有文字，逐字保真，仅输出图中实际出现的文本，不添加、改写或补充任何未出现的内容；保持自然段落与换行；表格按行展开，单元格以空格分隔；公式用线性文本表示。",
		aiProvider: "volc"
	}
};

// DOM (use let so we can create fallbacks if elements are missing)
let canvas = document.getElementById("canvas");
let overlay = document.getElementById("overlay");
let ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
let octx = overlay && overlay.getContext ? overlay.getContext("2d") : null;
let statusEl = document.getElementById("status");
let resultEl = document.getElementById("result-text");

// UI 绑定
let inputFile = document.getElementById("file-input");
let heroUpload = document.getElementById("hero-upload");
let uploadDrop = document.getElementById("upload-drop");
let btnLoadSample = document.getElementById("btn-load-sample");
let btnClear = document.getElementById("btn-clear");
let btnRotateL = document.getElementById("btn-rotate-left");
let btnRotateR = document.getElementById("btn-rotate-right");
let rotateRange = document.getElementById("rotate-range");
let rotateInput = document.getElementById("rotate-input");
let btnFlipH = document.getElementById("btn-flip-h");
let btnFlipV = document.getElementById("btn-flip-v");
let btnZoomIn = document.getElementById("btn-zoom-in");
let btnZoomOut = document.getElementById("btn-zoom-out");
let btnPerspectiveMode = document.getElementById("btn-perspective-mode");
let btnApplyCrop = document.getElementById("btn-apply-crop");
let btnResetImage = document.getElementById("btn-reset-image");
let btnSelectRect = document.getElementById("btn-select-rect");
let btnSelectLasso = document.getElementById("btn-select-lasso");
let btnOcrLocal = document.getElementById("btn-ocr-local");
let btnOcrAI = document.getElementById("btn-ocr-ai");
let btnAutoCorrect = document.getElementById("btn-auto-correct");
let btnCopy = document.getElementById("btn-copy");
let btnClearResult = document.getElementById("btn-clear-result");
let btnExportTxt = document.getElementById("btn-export-txt");
let btnExportDocx = document.getElementById("btn-export-docx");
let btnTranslateZh = document.getElementById("btn-translate-zh");
let btnExtractQuestions = document.getElementById("btn-extract-questions");
let resultPostEl = document.getElementById("result-text-post");

// Ensure canvases exist (create minimal fallbacks if missing) and contexts
function ensureCanvasesPresent() {
	try {
		const shell = document.querySelector('.canvas-shell') || document.body;
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.id = 'canvas';
			canvas.width = 800; canvas.height = 600;
			shell.appendChild(canvas);
		}
		if (!overlay) {
			overlay = document.createElement('canvas');
			overlay.id = 'overlay';
			overlay.width = canvas.width; overlay.height = canvas.height;
			overlay.style.position = 'absolute';
			overlay.style.top = '0'; overlay.style.left = '0';
			shell.appendChild(overlay);
		}
		if (!ctx && canvas.getContext) ctx = canvas.getContext('2d');
		if (!octx && overlay.getContext) octx = overlay.getContext('2d');
	} catch (e) {
		console.warn('ensureCanvasesPresent failed', e);
	}
}

// 设置相关
const modal = document.getElementById("settings-modal");
const btnOpenSettings = document.getElementById("btn-open-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const btnSaveSettings = document.getElementById("btn-save-settings");
const inputPromptExtra = document.getElementById("prompt-extra");
const themeSelect = document.getElementById("theme-select");
// 前端不再收集Key/模型，统一由后端代理火山引擎

// 初始化（保护性调用，防止同步异常阻断脚本）
try {
	init();
} catch (e) {
	console.error('Init failed', e);
	try { setStatus('初始化失败（查看控制台）'); } catch (err) { console.warn('setStatus unavailable', err); }
}

function init() {
	// 恢复本地设置
	try {
		const raw = localStorage.getItem("ocr_settings");
		if (raw) {
			const parsed = JSON.parse(raw);
			Object.assign(state.settings, parsed);
		}
	} catch {}
	if (inputPromptExtra) inputPromptExtra.value = state.settings.promptExtra || "";
	updateRotationUI(state.rotation || 0);
	// 确保画布存在（若页面缺少 canvas，则创建最低限度的替代元素）
	ensureCanvasesPresent();
	// 主题恢复
	const th = localStorage.getItem("theme") || "dark";
	document.body.setAttribute("data-theme", th);
	if (themeSelect) themeSelect.value = th;

	// OpenCV加载状态
	if (window.cv && window.cv.Mat) {
		state.cvReady = true;
	} else {
		document.addEventListener("opencvready", () => (state.cvReady = true));
	}
	if (window.cv && typeof window.cv['onRuntimeInitialized'] === "function") {
		window.cv['onRuntimeInitialized'] = () => {
			state.cvReady = true;
			setStatus("OpenCV.js 已就绪");
		};
	}

	// 上传交互
	if (heroUpload) heroUpload.addEventListener("click", () => inputFile?.click());
	if (uploadDrop) {
		uploadDrop.addEventListener("click", (e) => {
			if (e.target === uploadDrop || e.target.closest('.upload-drop')) {
				inputFile?.click();
			}
		});
		uploadDrop.addEventListener("dragover", (e) => {
			e.preventDefault();
			e.stopPropagation();
			uploadDrop.classList.add("dragging");
		});
		uploadDrop.addEventListener("dragleave", (e) => {
			e.preventDefault();
			uploadDrop.classList.remove("dragging");
		});
		uploadDrop.addEventListener("drop", async (e) => {
			e.preventDefault();
			e.stopPropagation();
			uploadDrop.classList.remove("dragging");
			if (e.dataTransfer?.files?.length) {
				await loadImageFile(e.dataTransfer.files[0]);
			}
		});
	}

    if (inputFile) inputFile.addEventListener("change", onFileChange);
    if (btnLoadSample) btnLoadSample.addEventListener("click", loadSample);
    if (btnClear) btnClear.addEventListener("click", () => {
        clearImage();
        if (resultEl) resultEl.value = "";
        if (resultPostEl) resultPostEl.value = "";
    });
    if (btnRotateL) btnRotateL.addEventListener("click", () => rotate(-90));
    if (btnRotateR) btnRotateR.addEventListener("click", () => rotate(90));
    if (rotateRange) {
        rotateRange.addEventListener("input", () => {
            const val = parseFloat(rotateRange.value) || 0;
            state.rotation = val;
            if (rotateInput) rotateInput.value = String(val);
            draw();
        });
    }
    if (rotateInput) {
        rotateInput.addEventListener("input", () => {
            const val = parseFloat(rotateInput.value) || 0;
            state.rotation = val;
            if (rotateRange) rotateRange.value = String(val);
            draw();
        });
    }
    if (btnFlipH) btnFlipH.addEventListener("click", () => { state.flipH = !state.flipH; draw(); });
    if (btnFlipV) btnFlipV.addEventListener("click", () => { state.flipV = !state.flipV; draw(); });
    if (btnZoomIn) btnZoomIn.addEventListener("click", () => zoom(1.2));
    if (btnZoomOut) btnZoomOut.addEventListener("click", () => zoom(1 / 1.2));
    if (btnPerspectiveMode) btnPerspectiveMode.addEventListener("click", () => setMode("perspective"));
    if (btnApplyCrop) btnApplyCrop.addEventListener("click", applyCropOrPerspective);
    if (btnResetImage) btnResetImage.addEventListener("click", restoreOriginalImage);
    if (btnSelectRect) btnSelectRect.addEventListener("click", () => { state.selectionMode = "rect"; setMode("crop"); });
    if (btnSelectLasso) btnSelectLasso.addEventListener("click", () => { state.selectionMode = "lasso"; setMode("crop"); });

    if (btnOcrLocal) btnOcrLocal.addEventListener("click", doLocalOcr);
    if (btnOcrAI) btnOcrAI.addEventListener("click", doAiOcr);
    if (btnAutoCorrect) btnAutoCorrect.addEventListener("click", autoDetectAndWarp);
    if (btnTranslateZh) btnTranslateZh.addEventListener("click", () => postProcessResult("translate_zh"));
    if (btnExtractQuestions) btnExtractQuestions.addEventListener("click", () => postProcessResult("extract_questions"));
    if (btnCopy) btnCopy.addEventListener("click", copyResult);
    if (btnClearResult) btnClearResult.addEventListener("click", () => {
        if (resultEl) resultEl.value = "";
        if (resultPostEl) resultPostEl.value = "";
        setStatus("已清空识别结果");
    });
    if (btnExportTxt) btnExportTxt.addEventListener("click", exportTxt);
    if (btnExportDocx) btnExportDocx.addEventListener("click", exportDocx);

	if (btnOpenSettings) btnOpenSettings.addEventListener("click", () => modal.classList.remove("hidden"));
	if (btnCloseSettings) btnCloseSettings.addEventListener("click", () => modal.classList.add("hidden"));
	if (btnSaveSettings) btnSaveSettings.addEventListener("click", saveSettings);

	waitForOpenCV();
	setupOverlayInteractions();
	resetView();
	setStatus("请上传图片开始");
}

function setStatus(msg) {
	if (statusEl) {
		statusEl.textContent = msg;
	} else {
		console.log("STATUS:", msg);
	}
}

function updateRotationUI(val) {
	if (rotateRange) rotateRange.value = String(val);
	if (rotateInput) rotateInput.value = String(val);
}

async function onFileChange(e) {
	const file = e.target.files?.[0];
	if (!file) return;
	await loadImageFile(file);
}

async function loadSample() {
	const sampleUrl = "./example.png";
	setStatus("加载示例图片中...");
	const res = await fetch(sampleUrl);
	const blob = await res.blob();
	await loadImageFile(new File([blob], "sample.jpg", { type: blob.type }));
}

async function loadImageFile(file) {
	const url = URL.createObjectURL(file);
	const img = new Image();
	img.onload = async () => {
		state.image = img;
		state.imageBitmap = await createImageBitmap(img);
		state.originalBitmap = state.imageBitmap;
		resetView();
		draw();
		URL.revokeObjectURL(url);
		setStatus(`已加载：${file.name}，${img.naturalWidth}×${img.naturalHeight}`);
		if (inputFile) inputFile.value = "";
	};
	img.onerror = () => {
		setStatus("图片加载失败");
	};
	img.src = url;
}

function clearImage() {
	state.image = null;
	state.imageBitmap = null;
	state.originalBitmap = null;
	state.mode = "none";
	state.cropRect = null;
	state.lassoPath = [];
	state.perspectivePoints = [];
	updateRotationUI(0);
	if (octx && overlay) {
		try { octx.clearRect(0, 0, overlay.width, overlay.height); } catch (e) {}
	}
	draw();
	if (resultEl) resultEl.value = "";
	if (resultPostEl) resultPostEl.value = "";
	setStatus("已清空工作区");
}

function resetView() {
	state.scale = 1;
	state.rotation = 0;
	state.flipH = false;
	state.flipV = false;
	state.offsetX = 0;
	state.offsetY = 0;
	state.mode = "none";
	state.cropRect = null;
	state.lassoPath = [];
	state.perspectivePoints = [];
	updateRotationUI(0);
	resizeCanvasToContainer();
	draw();
}

function restoreOriginalImage() {
	if (state.originalBitmap) {
		state.imageBitmap = state.originalBitmap;
		resetView();
		setStatus("已还原为原图");
	} else {
		setStatus("无原图可还原");
	}
}

function resizeCanvasToContainer() {
	if (!canvas) {
		ensureCanvasesPresent();
		if (!canvas) return;
	}
	const wrap = canvas.parentElement || canvas;
	const rect = wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : { width: canvas.width };
	const w = Math.max(480, Math.floor(rect.width));
	const h = Math.min(1000, Math.floor(w * 0.75));
	try { canvas.width = w; canvas.height = h; } catch (e) {}
	try { if (overlay) { overlay.width = w; overlay.height = h; } } catch (e) {}
}

function rotate(deg) {
	state.rotation = (state.rotation + deg) % 360;
	updateRotationUI(state.rotation);
	draw();
}

function zoom(factor) {
	state.scale = Math.min(10, Math.max(0.1, state.scale * factor));
	draw();
}

function setMode(mode) {
	state.mode = mode;
	state.cropRect = null;
	if (mode === "perspective") {
		state.perspectivePoints = [];
	}
	drawOverlay();
	setStatus(mode === "crop" ? (state.selectionMode === "lasso" ? "按下拖动自由勾勒区域，松开结束" : "拖拽以选择矩形区域") :
		mode === "perspective" ? "依次点击四个角点（顺时针）" : "浏览模式");
}

function draw() {
	if (!ctx) {
		ensureCanvasesPresent();
		if (!ctx) return;
	}
	try { ctx.clearRect(0, 0, canvas.width, canvas.height); } catch (e) { }
	if (!state.imageBitmap) {
		drawOverlay();
		return;
	}
	const img = state.imageBitmap;
	const viewW = canvas.width;
	const viewH = canvas.height;

	// 计算让图片居中以及缩放适配
	const scaleFit = Math.min(viewW / img.width, viewH / img.height);
	const baseScale = scaleFit * state.scale;
	const drawW = img.width * baseScale;
	const drawH = img.height * baseScale;
	const cx = viewW / 2 + state.offsetX;
	const cy = viewH / 2 + state.offsetY;

	ctx.save();
	ctx.translate(cx, cy);
	ctx.rotate((state.rotation * Math.PI) / 180);
	ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
	ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
	ctx.restore();

	drawOverlay();
}

function getViewTransform() {
	const img = state.imageBitmap;
	const viewW = canvas.width;
	const viewH = canvas.height;
	const scaleFit = Math.min(viewW / img.width, viewH / img.height);
	const baseScale = scaleFit * state.scale;
	const drawW = img.width * baseScale;
	const drawH = img.height * baseScale;
	const cx = viewW / 2 + state.offsetX;
	const cy = viewH / 2 + state.offsetY;
	return { baseScale, drawW, drawH, cx, cy };
}

function screenToImage(px, py) {
	const { baseScale, drawW, drawH, cx, cy } = getViewTransform();
	let x = px - cx;
	let y = py - cy;
	const rad = (-state.rotation * Math.PI) / 180;
	const cos = Math.cos(rad), sin = Math.sin(rad);
	const rx = x * cos - y * sin;
	const ry = x * sin + y * cos;
	const fx = state.flipH ? -rx : rx;
	const fy = state.flipV ? -ry : ry;
	const ix = (fx + drawW / 2) / baseScale;
	const iy = (fy + drawH / 2) / baseScale;
	return {
		x: Math.max(0, Math.min(state.imageBitmap.width - 1, ix)),
		y: Math.max(0, Math.min(state.imageBitmap.height - 1, iy))
	};
}

function warpByPoints(sp, dstW, dstH) {
	const widthTop = Math.hypot(sp[1].x - sp[0].x, sp[1].y - sp[0].y);
	const widthBottom = Math.hypot(sp[2].x - sp[3].x, sp[2].y - sp[3].y);
	const heightLeft = Math.hypot(sp[3].x - sp[0].x, sp[3].y - sp[0].y);
	const heightRight = Math.hypot(sp[2].x - sp[1].x, sp[2].y - sp[1].y);
	if (!dstW || !dstH) {
		dstW = Math.round(Math.max(widthTop, widthBottom));
		dstH = Math.round(Math.max(heightLeft, heightRight));
	}
	if (dstW < 10 || dstH < 10) {
		setStatus("选择区域过小");
		return null;
	}
	try {
		const srcMat = cv.imread(imageBitmapToCanvas(state.imageBitmap));
		const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
			sp[0].x, sp[0].y,
			sp[1].x, sp[1].y,
			sp[2].x, sp[2].y,
			sp[3].x, sp[3].y
		]);
		const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
			0, 0,
			dstW, 0,
			dstW, dstH,
			0, dstH
		]);
		const M = cv.getPerspectiveTransform(srcTri, dstTri);
		const dst = new cv.Mat();
		const dsize = new cv.Size(dstW, dstH);
		cv.warpPerspective(srcMat, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
		const out = document.createElement("canvas");
		out.width = dstW;
		out.height = dstH;
		cv.imshow(out, dst);
		srcMat.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
		return out;
	} catch (e) {
		console.error(e);
		setStatus("透视变换失败，详见控制台");
		return null;
	}
}

function drawOverlay() {
	if (!octx) {
		ensureCanvasesPresent();
		if (!octx) return;
	}
	try { octx.clearRect(0, 0, overlay.width, overlay.height); } catch (e) {}
	if (state.mode === "crop" && state.cropRect) {
		octx.strokeStyle = "#3b82f6";
		octx.lineWidth = 2;
		octx.setLineDash([6, 4]);
		octx.strokeRect(state.cropRect.x, state.cropRect.y, state.cropRect.w, state.cropRect.h);
		octx.setLineDash([]);
	}
	if (state.mode === "crop" && state.selectionMode === "lasso" && state.lassoPath.length > 1) {
		octx.strokeStyle = "#22c55e";
		octx.lineWidth = 2;
		octx.setLineDash([]);
		octx.beginPath();
		octx.moveTo(state.lassoPath[0].x, state.lassoPath[0].y);
		for (let i = 1; i < state.lassoPath.length; i++) {
			octx.lineTo(state.lassoPath[i].x, state.lassoPath[i].y);
		}
		octx.stroke();
		const first = state.lassoPath[0], last = state.lassoPath[state.lassoPath.length - 1];
		const d = Math.hypot(first.x - last.x, first.y - last.y);
		if (d < 12) {
			octx.fillStyle = "rgba(34,197,94,0.2)";
			octx.closePath(); octx.fill();
		}
	}
	if (state.mode === "perspective") {
		octx.fillStyle = "rgba(59,130,246,0.2)";
		octx.strokeStyle = "#3b82f6";
		octx.lineWidth = 2;
		for (let i = 0; i < state.perspectivePoints.length; i++) {
			const p = state.perspectivePoints[i];
			octx.beginPath();
			octx.arc(p.x, p.y, 6, 0, Math.PI * 2);
			octx.fill();
			octx.stroke();
		}
		if (state.perspectivePoints.length === 4) {
			octx.beginPath();
			const [p0,p1,p2,p3] = state.perspectivePoints;
			octx.moveTo(p0.x, p0.y);
			octx.lineTo(p1.x, p1.y);
			octx.lineTo(p2.x, p2.y);
			octx.lineTo(p3.x, p3.y);
			octx.closePath();
			octx.stroke();
		}
	}
}

function setupOverlayInteractions() {
	if (!overlay) {
		ensureCanvasesPresent();
		if (!overlay) return;
	}
	let dragging = false;
	let dragStart = null;
	let currentRect = null;
	let drawingLasso = false;

	function toCanvasPos(evt) {
		const rect = overlay.getBoundingClientRect();
		const x = (evt.clientX - rect.left) * (overlay.width / rect.width);
		const y = (evt.clientY - rect.top) * (overlay.height / rect.height);
		return { x, y };
	}

	overlay.addEventListener("mousedown", (e) => {
		if (state.mode === "crop") {
			if (state.selectionMode === "rect") {
				dragging = true;
				dragStart = toCanvasPos(e);
				currentRect = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
				state.cropRect = currentRect;
			} else {
				drawingLasso = true;
				state.lassoPath = [toCanvasPos(e)];
			}
			drawOverlay();
		} else if (state.mode === "perspective") {
			const p = toCanvasPos(e);
			if (state.perspectivePoints.length < 4) {
				state.perspectivePoints.push(p);
				drawOverlay();
			}
		}
	});
	window.addEventListener("mousemove", (e) => {
		if (state.mode === "crop" && dragging && currentRect) {
			const pos = toCanvasPos(e);
			currentRect.w = pos.x - dragStart.x;
			currentRect.h = pos.y - dragStart.y;
			// 规范化为正宽高
			const x = Math.min(dragStart.x, pos.x);
			const y = Math.min(dragStart.y, pos.y);
			const w = Math.abs(currentRect.w);
			const h = Math.abs(currentRect.h);
			state.cropRect = { x, y, w, h };
			drawOverlay();
		} else if (state.mode === "crop" && drawingLasso) {
			const pos = toCanvasPos(e);
			state.lassoPath.push(pos);
			drawOverlay();
		}
	});
	window.addEventListener("mouseup", () => {
		if (state.mode === "crop") {
			if (dragging) {
				dragging = false;
				dragStart = null;
				currentRect = null;
			}
			if (drawingLasso) {
				drawingLasso = false;
				if (state.lassoPath.length > 3) {
					const a = state.lassoPath[0], b = state.lassoPath[state.lassoPath.length - 1];
					if (Math.hypot(a.x - b.x, a.y - b.y) < 12) {
						state.lassoPath.push({ x: a.x, y: a.y });
					}
				}
				drawOverlay();
			}
		}
	});
}

function applyCropOrPerspective() {
	if (!state.imageBitmap) return;
	if (state.mode === "crop" && (state.cropRect || (state.selectionMode === "lasso" && state.lassoPath.length > 2))) {
		const cropped = state.selectionMode === "lasso" ? cropFromLassoPath(state.lassoPath) : cropFromCanvasRect(state.cropRect);
		if (cropped) {
			replaceImageWithBitmap(cropped, "已应用裁剪");
			state.mode = "none";
			state.cropRect = null;
			state.lassoPath = [];
			drawOverlay();
		}
	} else if (state.mode === "perspective" && state.perspectivePoints.length === 4) {
		if (!state.cvReady) {
			setStatus("OpenCV.js 尚未就绪");
			return;
		}
		const warped = perspectiveWarpFromPoints(state.perspectivePoints);
		if (warped) {
			replaceImageWithBitmap(warped, "已应用透视矫正");
			state.mode = "none";
			state.perspectivePoints = [];
			drawOverlay();
		}
	} else {
		setStatus("请先完成框选或选择四个角点");
	}
}

function cropFromCanvasRect(rect) {
	if (!state.imageBitmap) return null;
	// 将矩形四角映射到原图坐标，再做透视矫正得到轴对齐裁剪
	const p0 = screenToImage(rect.x, rect.y);
	const p1 = screenToImage(rect.x + rect.w, rect.y);
	const p2 = screenToImage(rect.x + rect.w, rect.y + rect.h);
	const p3 = screenToImage(rect.x, rect.y + rect.h);
	const dstW = Math.max(2, Math.round(rect.w * (state.imageBitmap.width / canvas.width)));
	const dstH = Math.max(2, Math.round(rect.h * (state.imageBitmap.height / canvas.height)));
	return warpByPoints([p0, p1, p2, p3], dstW, dstH);
}

function cropFromLassoPath(path) {
	if (!state.imageBitmap || path.length < 3) return null;
	const img = state.imageBitmap;
	const pts = path.map(p => screenToImage(p.x, p.y));
	const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
	const minX = Math.max(0, Math.floor(Math.min(...xs)));
	const minY = Math.max(0, Math.floor(Math.min(...ys)));
	const maxX = Math.min(img.width, Math.ceil(Math.max(...xs)));
	const maxY = Math.min(img.height, Math.ceil(Math.max(...ys)));
	const roiW = Math.max(2, maxX - minX);
	const roiH = Math.max(2, maxY - minY);
	try {
		const srcMat = cv.imread(imageBitmapToCanvas(img));
		const mask = new cv.Mat.zeros(img.width ? img.height : srcMat.rows, img.width ? img.width : srcMat.cols, cv.CV_8UC1);
		const arr = [];
		pts.forEach(p => { arr.push(p.x, p.y); });
		const poly = cv.matFromArray(pts.length, 1, cv.CV_32SC2, arr);
		const mv = new cv.MatVector(); mv.push_back(poly);
		cv.fillPoly(mask, mv, new cv.Scalar(255));
		const out = new cv.Mat();
		cv.bitwise_and(srcMat, srcMat, out, mask);
		const rect = new cv.Rect(minX, minY, roiW, roiH);
		const cropped = out.roi(rect);
		const canvasOut = document.createElement("canvas");
		canvasOut.width = roiW; canvasOut.height = roiH;
		cv.imshow(canvasOut, cropped);
		srcMat.delete(); mask.delete(); poly.delete(); mv.delete(); out.delete(); cropped.delete();
		return canvasOut;
	} catch (e) {
		console.error(e);
		setStatus("自由框选裁剪失败");
		return null;
	}
}

function perspectiveWarpFromPoints(points) {
	// 将屏幕四点映射到原图坐标，再执行warp
	const sp = points.map(p => screenToImage(p.x, p.y));
	return warpByPoints(sp);
}

function orderQuad(points) {
	const pts = points.slice().sort((a,b) => a.y - b.y);
	const top = pts.slice(0,2).sort((a,b) => a.x - b.x);
	const bottom = pts.slice(2,4).sort((a,b) => a.x - b.x);
	return [top[0], top[1], bottom[1], bottom[0]];
}

function autoDetectAndWarp() {
	if (!state.imageBitmap) {
		setStatus("请先加载图片");
		return;
	}
	if (!state.cvReady) {
		setStatus("OpenCV.js 尚未就绪");
		return;
	}
	try {
		const srcCanvas = imageBitmapToCanvas(state.imageBitmap);
		const src = cv.imread(srcCanvas);
		const gray = new cv.Mat();
		cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
		const blur = new cv.Mat();
		cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
		const thresh = new cv.Mat();
		cv.adaptiveThreshold(blur, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 8);
		cv.bitwise_not(thresh, thresh);
		const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
		const morphed = new cv.Mat();
		cv.morphologyEx(thresh, morphed, cv.MORPH_CLOSE, kernel);
		const edges = new cv.Mat();
		cv.Canny(morphed, edges, 60, 180);
		const contours = new cv.MatVector();
		const hierarchy = new cv.Mat();
		cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
		const imgArea = src.rows * src.cols;
		let bestApprox = null;
		let bestArea = 0;
		let fallbackRect = null;
		let fallbackArea = 0;
		for (let i = 0; i < contours.size(); i++) {
			const cnt = contours.get(i);
			const area = cv.contourArea(cnt);
			if (area < imgArea * 0.12) {
				cnt.delete();
				continue;
			}
			const peri = cv.arcLength(cnt, true);
			const approx = new cv.Mat();
			cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
			if (approx.rows === 4 && area > bestArea) {
				bestArea = area;
				if (bestApprox) bestApprox.delete();
				bestApprox = approx;
			} else {
				approx.delete();
			}
			if (area > fallbackArea) {
				fallbackArea = area;
				fallbackRect = cv.minAreaRect(cnt);
			}
			cnt.delete();
		}
		let bestPoints = null;
		if (bestApprox) {
			bestPoints = [];
			for (let i = 0; i < 4; i++) {
				const p = bestApprox.intPtr(i);
				bestPoints.push({ x: p[0], y: p[1] });
			}
			bestApprox.delete();
		}
		if (!bestPoints && fallbackRect) {
			const points = cv.Mat.zeros(4, 1, cv.CV_32FC2);
			cv.boxPoints(fallbackRect, points);
			bestPoints = [];
			for (let i = 0; i < 4; i++) {
				const ptr = points.floatPtr(i);
				bestPoints.push({ x: ptr[0], y: ptr[1] });
			}
			points.delete();
		}
		let outCanvas = null;
		if (bestPoints && bestPoints.length === 4) {
			const ordered = orderQuad(bestPoints);
			outCanvas = warpByPoints(ordered);
		}
		if (outCanvas) {
			try {
				const mat = cv.imread(outCanvas);
				const gray2 = new cv.Mat();
				cv.cvtColor(mat, gray2, cv.COLOR_RGBA2GRAY, 0);
				const edges2 = new cv.Mat();
				cv.Canny(gray2, edges2, 50, 150);
				const lines = new cv.Mat();
				cv.HoughLines(edges2, lines, 1, Math.PI / 180, Math.max(120, Math.floor(outCanvas.width * 0.4)));
				let angleDeg = 0;
				let count = 0;
				for (let i = 0; i < lines.rows; i++) {
					const theta = lines.data32F[i * 2 + 1];
					let deg = (theta * 180 / Math.PI) - 90;
					if (deg > 90) deg -= 180;
					if (deg < -90) deg += 180;
					angleDeg += deg;
					count++;
				}
				if (count > 0) {
					angleDeg /= count;
					if (Math.abs(angleDeg) > 0.5) {
						outCanvas = rotateCanvas(outCanvas, -angleDeg);
					}
				}
				mat.delete(); gray2.delete(); edges2.delete(); lines.delete();
			} catch (err) {
				console.warn("Deskew failed", err);
			}
			replaceImageWithBitmap(outCanvas, "已自动矫正");
		} else {
			setStatus("未检测到明显的文档轮廓，建议手动矫正");
		}
		src.delete(); gray.delete(); blur.delete(); thresh.delete(); kernel.delete(); morphed.delete(); edges.delete(); contours.delete(); hierarchy.delete();
	} catch (e) {
		console.error(e);
		setStatus("自动矫正失败，请手动四点矫正");
	}
}

function imageBitmapToCanvas(bitmap) {
	const c = document.createElement("canvas");
	c.width = bitmap.width;
	c.height = bitmap.height;
	const cx = c.getContext("2d");
	cx.drawImage(bitmap, 0, 0);
	return c;
}

async function replaceImageWithBitmap(canvasOrBitmap, statusMsg = "") {
	let bmp;
	if (canvasOrBitmap instanceof HTMLCanvasElement) {
		bmp = await createImageBitmap(canvasOrBitmap);
	} else if ("close" in canvasOrBitmap) {
		bmp = canvasOrBitmap;
	} else {
		setStatus("替换图像失败：不支持的类型");
		return;
	}
	state.imageBitmap = bmp;
	// 不要替换 originalBitmap，保持原始图片引用
	if (!state.originalBitmap) {
		state.originalBitmap = bmp;
	}
	state.image = null;
	resetView();
	draw();
	if (statusMsg) setStatus(statusMsg);
}

async function doLocalOcr() {
	if (!state.imageBitmap) {
		setStatus("请先加载图片");
		return;
	}
	if (resultEl) resultEl.value = "";
	if (resultPostEl) resultPostEl.value = "";
	setStatus("本地识别中（Tesseract.js）...");
	const lang = "chi_sim+eng";
	try {
		const worker = await Tesseract.createWorker(lang, 1, {
			logger: m => {
				if (m?.status) setStatus(`识别中：${m.status} ${(m.progress * 100 || 0).toFixed(0)}%`);
			}
		});
		const dataUrl = imageBitmapToCanvas(state.imageBitmap).toDataURL("image/png");
		const ret = await worker.recognize(dataUrl);
		await worker.terminate();
		const text = (ret?.data?.text || "").trim();
		if (resultEl) resultEl.value = text;
		await autoCopyResultText(text, "本地识别完成");
	} catch (e) {
		console.error(e);
		setStatus("本地识别失败，详见控制台");
	}
}

async function doAiOcr() {
	if (!state.imageBitmap) {
		setStatus("请先加载图片");
		return;
	}
	if (resultEl) resultEl.value = "";
	if (resultPostEl) resultPostEl.value = "";
	const prompt = (state.settings.promptExtra || "").trim();
	setStatus("AI 识别中...");
	try {
		const imageDataUrl = imageBitmapToCanvas(state.imageBitmap).toDataURL("image/png");
		const resp = await fetch("/api/ai/ocr", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ imageDataUrl, prompt })
		});
		if (!resp.ok) {
			const errText = await resp.text();
			throw new Error(errText);
		}
		const data = await resp.json();
		const text = (data?.text || "").trim();
		// 将 AI 识别结果写入 AI 输出框（而不是本地结果框）
		if (resultPostEl) {
			resultPostEl.value = text;
			await autoCopyResultText(text, "AI 识别完成");
		} else {
			// 兼容性回退（若 AI 输出框不存在），写入本地结果框
			if (resultEl) resultEl.value = text;
			await autoCopyResultText(text, "AI 识别完成");
		}
	} catch (e) {
		console.error(e);
		setStatus("AI 识别失败，详见控制台");
	}
}

async function postProcessResult(task) {
	// 优先对 AI 输出框的内容进行后处理（若有），否则回退到本地识别结果
	const src = ((resultPostEl && resultPostEl.value) || (resultEl && resultEl.value) || "").trim();
	if (!src) { setStatus("请先完成文字识别后再进行处理"); return; }
	try {
		setStatus("AI处理中...");
		const resp = await fetch("/api/ai/post", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ task, text: src })
		});
		if (!resp.ok) { throw new Error(await resp.text()); }
		const data = await resp.json();
		const text = data?.text || "";
		if (resultPostEl) resultPostEl.value = text;
		await autoCopyResultText(text, "AI处理完成");
	} catch (e) {
		console.error(e);
		setStatus("AI处理失败");
	}
}

async function copyResult() {
	const text = (resultPostEl && resultPostEl.value) ? resultPostEl.value : (resultEl ? resultEl.value : "");
	await autoCopyResultText(text || "", "识别结果已复制");
}

function exportTxt() {
	// 导出优先使用 AI 输出（若有），否则使用本地识别结果
	const text = (resultPostEl && resultPostEl.value) ? resultPostEl.value : (resultEl ? resultEl.value : "");
	const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
	saveAs(blob, "ocr_result.txt");
}

function exportDocx() {
	const text = ((resultPostEl && resultPostEl.value) ? resultPostEl.value : (resultEl ? resultEl.value : "")).replace(/\r\n/g, "\n");
	const { Document, Packer, Paragraph, HeadingLevel } = docx;
	const paragraphs = [];
	paragraphs.push(new Paragraph({ text: "识别结果", heading: HeadingLevel.HEADING_2 }));
	text.split("\n").forEach(line => {
		paragraphs.push(new Paragraph({ text: line }));
	});
	const doc = new Document({ sections: [{ children: paragraphs }] });
	Packer.toBlob(doc).then(blob => saveAs(blob, "ocr_result.docx"));
}

async function autoCopyResultText(text, baseMsg) {
	const trimmed = text || "";
	if (!trimmed) {
		setStatus(`${baseMsg}（无内容可复制）`);
		return;
	}
	try {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			await navigator.clipboard.writeText(trimmed);
			setStatus(`${baseMsg}（已自动复制）`);
		} else {
			// 降级方案：使用传统方法
			const textarea = document.createElement("textarea");
			textarea.value = trimmed;
			textarea.style.position = "fixed";
			textarea.style.left = "-9999px";
			textarea.style.top = "0";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			try {
				const success = document.execCommand("copy");
				document.body.removeChild(textarea);
				if (success) {
					setStatus(`${baseMsg}（已自动复制）`);
				} else {
					setStatus(`${baseMsg}（复制失败，请手动复制）`);
				}
			} catch (e) {
				document.body.removeChild(textarea);
				setStatus(`${baseMsg}（复制失败，请手动复制）`);
			}
		}
	} catch (e) {
		console.warn("Copy failed", e);
		// 尝试降级方案
		try {
			const textarea = document.createElement("textarea");
			textarea.value = trimmed;
			textarea.style.position = "fixed";
			textarea.style.left = "-9999px";
			textarea.style.top = "0";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			const success = document.execCommand("copy");
			document.body.removeChild(textarea);
			if (success) {
				setStatus(`${baseMsg}（已自动复制）`);
			} else {
				setStatus(`${baseMsg}（复制失败，请手动复制）`);
			}
		} catch (e2) {
			setStatus(`${baseMsg}（复制失败，请手动复制）`);
		}
	}
}

function saveSettings() {
	if (inputPromptExtra) state.settings.promptExtra = inputPromptExtra.value.trim();
	if (themeSelect) {
		const th = themeSelect.value === "light" ? "light" : "dark";
		document.body.setAttribute("data-theme", th);
		try { localStorage.setItem("theme", th); } catch {}
	}
	try {
		localStorage.setItem("ocr_settings", JSON.stringify(state.settings));
	} catch {}
	modal.classList.add("hidden");
	setStatus("设置已保存");
}

function waitForOpenCV() {
	const tryMark = () => {
		if (window.cv && window.cv.Mat) {
			if (!state.cvReady) {
				state.cvReady = true;
				setStatus("OpenCV.js 已就绪");
			}
			return true;
		}
		return false;
	};
	if (tryMark()) return;
	if (window.cv) {
		window.cv['onRuntimeInitialized'] = () => {
			state.cvReady = true;
			setStatus("OpenCV.js 已就绪");
		};
	}
	let cnt = 0;
	const timer = setInterval(() => {
		if (tryMark() || cnt++ > 200) {
			clearInterval(timer);
		}
	}, 100);
}
// 监听窗口大小变化，重绘
window.addEventListener("resize", () => {
	resizeCanvasToContainer();
	draw();
});


