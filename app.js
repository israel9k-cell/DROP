// TimeLens - Vintage Camera App
(function() {
    'use strict';

    // ==================== STATE ====================
    let currentEra = '1920';
    let currentStream = null;
    let facingMode = 'environment';
    let flashEnabled = false;
    let gallery = JSON.parse(localStorage.getItem('timelens_gallery') || '[]');

    // Editor state
    let editorBaseImage = null; // ImageData before adjustments
    let drawHistory = [];
    let drawColor = '#FFFFFF';
    let drawSize = 3;
    let isDrawing = false;
    let textColor = '#FFFFFF';
    let activeTool = 'adjust';
    let autodreamEnabled = false;

    // ==================== DOM ====================
    const $ = id => document.getElementById(id);
    const splash = $('splash');
    const app = $('app');
    const cameraView = $('camera-view');
    const resultView = $('result-view');
    const galleryView = $('gallery-view');
    const video = $('camera-feed');
    const previewCanvas = $('preview-canvas');
    const resultCanvas = $('result-canvas');
    const eraLabel = $('era-label');
    const eraPicker = $('era-picker');
    const dateStamp = $('date-stamp');
    const galleryGrid = $('gallery-grid');
    const galleryEmpty = $('gallery-empty');
    const galleryThumb = $('gallery-thumb');
    const fileInput = $('file-input');
    const sendModal = $('send-modal');
    const editorView = $('editor-view');
    const editorCanvas = $('editor-canvas');
    const drawCanvas = $('draw-canvas');

    // ==================== ERA CONFIG ====================
    const eras = {
        '1850': { label: '1850s', name: 'Daguerrotipo', yearRange: [1845, 1865] },
        '1900': { label: '1900s', name: 'Sepia clasico', yearRange: [1895, 1915] },
        '1920': { label: '1920s', name: 'Cine mudo', yearRange: [1918, 1932] },
        '1950': { label: '1950s', name: 'Blanco y negro', yearRange: [1945, 1962] },
        '1970': { label: '1970s', name: 'Polaroid retro', yearRange: [1968, 1982] },
        '1990': { label: '1990s', name: 'Camara desechable', yearRange: [1988, 1999] }
    };

    // ==================== INIT ====================
    setTimeout(() => {
        splash.classList.add('fade-out');
        setTimeout(() => {
            splash.classList.add('hidden');
            app.classList.remove('hidden');
            startCamera();
        }, 600);
    }, 2200);

    // Set defaults
    eraLabel.textContent = eras[currentEra].label;
    eraPicker.querySelector('[data-era="1920"]').classList.add('selected');
    eraPicker.querySelector('[data-era="1850"]').classList.remove('selected');
    updateGalleryThumb();

    // ==================== CAMERA ====================
    async function startCamera() {
        try {
            if (currentStream) {
                currentStream.getTracks().forEach(t => t.stop());
            }
            currentStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
                audio: false
            });
            video.srcObject = currentStream;
        } catch (err) {
            console.error('Camera error:', err);
            showToast('No se pudo acceder a la camara');
        }
    }

    // Switch camera
    $('btn-switch-cam').addEventListener('click', () => {
        facingMode = facingMode === 'environment' ? 'user' : 'environment';
        startCamera();
    });

    // Flash toggle
    $('btn-flash').addEventListener('click', () => {
        flashEnabled = !flashEnabled;
        $('btn-flash').classList.toggle('flash-on', flashEnabled);
    });

    // ==================== AUTODREAM ====================
    const dreamOverlay = $('dream-overlay');
    const autodreamBtn = $('btn-autodream');

    autodreamBtn.addEventListener('click', () => {
        autodreamEnabled = !autodreamEnabled;
        autodreamBtn.classList.toggle('active', autodreamEnabled);
        dreamOverlay.classList.toggle('active', autodreamEnabled);
    });

    // ==================== ERA PICKER ====================
    $('btn-era').addEventListener('click', () => {
        eraPicker.classList.toggle('hidden');
    });

    eraPicker.addEventListener('click', (e) => {
        const option = e.target.closest('.era-option');
        if (!option) return;
        eraPicker.querySelectorAll('.era-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        currentEra = option.dataset.era;
        eraLabel.textContent = eras[currentEra].label;
        eraPicker.classList.add('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.era-btn') && !e.target.closest('.era-picker')) {
            eraPicker.classList.add('hidden');
        }
    });

    // ==================== CAPTURE ====================
    $('btn-capture').addEventListener('click', captureFromVideo);

    function captureFromVideo() {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (!w || !h) return;

        previewCanvas.width = w;
        previewCanvas.height = h;
        const ctx = previewCanvas.getContext('2d');

        if (facingMode === 'user') {
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, w, h);

        if (flashEnabled) {
            const flash = document.createElement('div');
            flash.className = 'flash-overlay';
            document.body.appendChild(flash);
            setTimeout(() => flash.remove(), 300);
        }

        showProcessing();
        setTimeout(() => applyVintageFilter(previewCanvas), 100);
    }

    // ==================== UPLOAD / SEND PHOTO ====================
    $('btn-upload').addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => {
            previewCanvas.width = img.width;
            previewCanvas.height = img.height;
            previewCanvas.getContext('2d').drawImage(img, 0, 0);
            showProcessing();
            setTimeout(() => applyVintageFilter(previewCanvas), 100);
        };
        img.src = URL.createObjectURL(file);
        fileInput.value = '';
    });

    // ==================== PROCESSING OVERLAY ====================
    function showProcessing() {
        const overlay = document.createElement('div');
        overlay.className = 'processing-overlay';
        overlay.id = 'processing';
        const dreamMsg = autodreamEnabled
            ? '<div class="processing-text dream-text">Entrando al sueno...</div>'
            : '<div class="processing-text">Viajando al pasado...</div>';
        overlay.innerHTML = '<div class="processing-spinner"></div>' + dreamMsg;
        document.body.appendChild(overlay);
    }

    function hideProcessing() {
        const el = $('processing');
        if (el) el.remove();
    }

    // ==================== VINTAGE FILTER ENGINE ====================
    function applyVintageFilter(sourceCanvas) {
        const w = sourceCanvas.width;
        const h = sourceCanvas.height;
        resultCanvas.width = w;
        resultCanvas.height = h;
        const ctx = resultCanvas.getContext('2d');
        ctx.drawImage(sourceCanvas, 0, 0);

        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        switch (currentEra) {
            case '1850': applyDaguerreotype(data, w, h); break;
            case '1900': applySepia1900(data, w, h); break;
            case '1920': applySilentFilm(data, w, h); break;
            case '1950': applyBW1950(data, w, h); break;
            case '1970': applyPolaroid70(data, w, h); break;
            case '1990': applyDisposable90(data, w, h); break;
        }

        ctx.putImageData(imageData, 0, 0);

        // Post-processing overlays
        applyVignette(ctx, w, h);

        if (currentEra === '1850' || currentEra === '1900' || currentEra === '1920') {
            applyScratches(ctx, w, h);
            applyDust(ctx, w, h);
        }
        if (currentEra === '1970') applyLightLeak(ctx, w, h);
        if (currentEra === '1990') applyFlashGlare(ctx, w, h);

        // Autodream effect
        if (autodreamEnabled) {
            applyDreamEffect(ctx, w, h);
        }

        // Date stamp
        const era = eras[currentEra];
        const year = randomInt(era.yearRange[0], era.yearRange[1]);
        const month = randomInt(1, 12);
        const day = randomInt(1, 28);
        const dateStr = `${month.toString().padStart(2,'0')} ${day.toString().padStart(2,'0')} ${year}`;

        if (currentEra === '1970' || currentEra === '1990') {
            ctx.font = `bold ${Math.round(w * 0.025)}px 'Courier New', monospace`;
            ctx.fillStyle = currentEra === '1970' ? '#e8940080' : '#ff6a0090';
            ctx.textAlign = 'right';
            ctx.fillText(dateStr, w - w * 0.04, h - h * 0.03);
        }

        dateStamp.textContent = currentEra <= '1920' ? `circa ${year}` : dateStr;

        // Save to gallery
        const thumbData = createThumbnail(resultCanvas, 300);
        const fullData = resultCanvas.toDataURL('image/jpeg', 0.85);
        gallery.unshift({ thumb: thumbData, full: fullData, era: currentEra, date: dateStr, ts: Date.now() });
        if (gallery.length > 50) gallery.pop();
        saveGallery();
        updateGalleryThumb();

        hideProcessing();
        showResult();
    }

    // ==================== FILTER FUNCTIONS ====================

    function applyDaguerreotype(data, w, h) {
        for (let i = 0; i < data.length; i += 4) {
            let gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
            gray = gray * 0.55 + 60;
            data[i] = clamp(gray * 0.92);
            data[i+1] = clamp(gray * 0.93);
            data[i+2] = clamp(gray * 1.0);
            const noise = (Math.random() - 0.5) * 50;
            data[i] = clamp(data[i] + noise);
            data[i+1] = clamp(data[i+1] + noise);
            data[i+2] = clamp(data[i+2] + noise);
        }
        blurEdges(data, w, h, 0.3);
    }

    function applySepia1900(data, w, h) {
        for (let i = 0; i < data.length; i += 4) {
            let gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
            data[i] = clamp(gray * 1.15 + 20);
            data[i+1] = clamp(gray * 0.90 + 10);
            data[i+2] = clamp(gray * 0.65);
            const noise = (Math.random() - 0.5) * 35;
            data[i] = clamp(data[i] + noise);
            data[i+1] = clamp(data[i+1] + noise);
            data[i+2] = clamp(data[i+2] + noise);
        }
    }

    function applySilentFilm(data, w, h) {
        for (let i = 0; i < data.length; i += 4) {
            let gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
            gray = Math.pow(gray / 255, 1.3) * 255;
            data[i] = clamp(gray * 1.05 + 5);
            data[i+1] = clamp(gray * 1.0);
            data[i+2] = clamp(gray * 0.9);
            const noise = (Math.random() - 0.5) * 40;
            data[i] = clamp(data[i] + noise);
            data[i+1] = clamp(data[i+1] + noise);
            data[i+2] = clamp(data[i+2] + noise);
        }
    }

    function applyBW1950(data, w, h) {
        for (let i = 0; i < data.length; i += 4) {
            let gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
            gray = Math.pow(gray / 255, 0.9) * 260 - 10;
            data[i] = clamp(gray);
            data[i+1] = clamp(gray);
            data[i+2] = clamp(gray);
            const noise = (Math.random() - 0.5) * 20;
            data[i] = clamp(data[i] + noise);
            data[i+1] = clamp(data[i+1] + noise);
            data[i+2] = clamp(data[i+2] + noise);
        }
    }

    function applyPolaroid70(data, w, h) {
        for (let i = 0; i < data.length; i += 4) {
            data[i] = clamp(data[i] * 1.1 + 15);
            data[i+1] = clamp(data[i+1] * 1.0 + 5);
            data[i+2] = clamp(data[i+2] * 0.8);
            const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
            data[i] = clamp(data[i] * 0.75 + gray * 0.25);
            data[i+1] = clamp(data[i+1] * 0.75 + gray * 0.25);
            data[i+2] = clamp(data[i+2] * 0.75 + gray * 0.25);
            const noise = (Math.random() - 0.5) * 18;
            data[i] = clamp(data[i] + noise);
            data[i+1] = clamp(data[i+1] + noise);
            data[i+2] = clamp(data[i+2] + noise);
        }
        for (let i = 0; i < data.length; i += 4) {
            data[i] = clamp(data[i] * 0.85 + 30);
            data[i+1] = clamp(data[i+1] * 0.85 + 25);
            data[i+2] = clamp(data[i+2] * 0.85 + 20);
        }
    }

    function applyDisposable90(data, w, h) {
        for (let i = 0; i < data.length; i += 4) {
            data[i] = clamp(data[i] * 1.05 + 5);
            data[i+1] = clamp(data[i+1] * 1.1 + 8);
            data[i+2] = clamp(data[i+2] * 0.85);
            const noise = (Math.random() - 0.5) * 25;
            data[i] = clamp(data[i] + noise);
            data[i+1] = clamp(data[i+1] + noise);
            data[i+2] = clamp(data[i+2] + noise);
        }
        for (let i = 0; i < data.length; i += 4) {
            data[i] = clamp(data[i] * 0.9 + 20);
            data[i+1] = clamp(data[i+1] * 0.9 + 20);
            data[i+2] = clamp(data[i+2] * 0.9 + 15);
        }
    }

    // ==================== AUTODREAM EFFECT ====================

    function applyDreamEffect(ctx, w, h) {
        // 1. Soft glow - brighten highlights and blur
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = w;
        glowCanvas.height = h;
        const gctx = glowCanvas.getContext('2d');
        gctx.drawImage(ctx.canvas, 0, 0);

        // Extract and boost highlights
        const glowData = gctx.getImageData(0, 0, w, h);
        const gd = glowData.data;
        for (let i = 0; i < gd.length; i += 4) {
            const lum = gd[i] * 0.299 + gd[i+1] * 0.587 + gd[i+2] * 0.114;
            const factor = Math.max(0, (lum - 120) / 135);
            gd[i] = clamp(gd[i] + factor * 80);
            gd[i+1] = clamp(gd[i+1] + factor * 60);
            gd[i+2] = clamp(gd[i+2] + factor * 100);
        }
        gctx.putImageData(glowData, 0, 0);

        // Blend glow layer with soft light
        ctx.globalAlpha = 0.35;
        ctx.globalCompositeOperation = 'screen';
        ctx.filter = 'blur(12px)';
        ctx.drawImage(glowCanvas, 0, 0);
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0;

        // 2. Color shift - purple/blue dreamlike tint
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
            // Shift shadows to purple, highlights to cyan
            const lum = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
            const shadowFactor = Math.max(0, 1 - lum / 128);
            const highFactor = Math.max(0, (lum - 128) / 127);

            // Purple in shadows
            d[i] = clamp(d[i] + shadowFactor * 15);
            d[i+1] = clamp(d[i+1] - shadowFactor * 8);
            d[i+2] = clamp(d[i+2] + shadowFactor * 25);

            // Cyan/pink in highlights
            d[i] = clamp(d[i] + highFactor * 10);
            d[i+1] = clamp(d[i+1] + highFactor * 8);
            d[i+2] = clamp(d[i+2] + highFactor * 15);

            // Slight desaturation for ethereal feel
            const gray = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
            d[i] = clamp(d[i] * 0.85 + gray * 0.15);
            d[i+1] = clamp(d[i+1] * 0.85 + gray * 0.15);
            d[i+2] = clamp(d[i+2] * 0.85 + gray * 0.15);
        }
        ctx.putImageData(imgData, 0, 0);

        // 3. Ethereal light orbs
        const orbCount = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < orbCount; i++) {
            const ox = Math.random() * w;
            const oy = Math.random() * h;
            const or = w * (0.08 + Math.random() * 0.15);
            const colors = [
                [160, 100, 255],
                [100, 180, 255],
                [255, 100, 200],
                [100, 255, 200],
                [255, 200, 100]
            ];
            const c = colors[Math.floor(Math.random() * colors.length)];
            const gradient = ctx.createRadialGradient(ox, oy, 0, ox, oy, or);
            gradient.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.12)`);
            gradient.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},0.05)`);
            gradient.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, w, h);
        }

        // 4. Subtle sparkle particles
        const sparkleCount = 15 + Math.floor(Math.random() * 20);
        for (let i = 0; i < sparkleCount; i++) {
            const sx = Math.random() * w;
            const sy = Math.random() * h;
            const sr = Math.random() * 3 + 1;
            const alpha = 0.3 + Math.random() * 0.5;
            ctx.fillStyle = `rgba(255,255,255,${alpha})`;
            ctx.beginPath();
            ctx.arc(sx, sy, sr, 0, Math.PI * 2);
            ctx.fill();
            // Cross sparkle
            if (Math.random() > 0.6) {
                ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.5})`;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(sx - sr * 3, sy);
                ctx.lineTo(sx + sr * 3, sy);
                ctx.moveTo(sx, sy - sr * 3);
                ctx.lineTo(sx, sy + sr * 3);
                ctx.stroke();
            }
        }

        // 5. Dreamy vignette with color
        const dreamVig = ctx.createRadialGradient(w/2, h/2, w * 0.3, w/2, h/2, w * 0.7);
        dreamVig.addColorStop(0, 'rgba(0,0,0,0)');
        dreamVig.addColorStop(1, 'rgba(40,10,60,0.35)');
        ctx.fillStyle = dreamVig;
        ctx.fillRect(0, 0, w, h);
    }

    // ==================== OVERLAY EFFECTS ====================

    function applyVignette(ctx, w, h) {
        const gradient = ctx.createRadialGradient(w/2, h/2, w*0.25, w/2, h/2, w*0.75);
        const intensity = currentEra === '1850' ? 0.7 : currentEra <= '1920' ? 0.5 : 0.35;
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, `rgba(0,0,0,${intensity})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }

    function applyScratches(ctx, w, h) {
        const count = currentEra === '1850' ? 15 : currentEra === '1900' ? 10 : 6;
        ctx.strokeStyle = 'rgba(255,255,240,0.12)';
        ctx.lineWidth = 1;
        for (let i = 0; i < count; i++) {
            ctx.beginPath();
            const x = Math.random() * w;
            ctx.moveTo(x, Math.random() * h * 0.2);
            ctx.lineTo(x + (Math.random() - 0.5) * 30, h - Math.random() * h * 0.2);
            ctx.stroke();
        }
    }

    function applyDust(ctx, w, h) {
        const count = currentEra === '1850' ? 60 : 30;
        for (let i = 0; i < count; i++) {
            ctx.fillStyle = `rgba(255,255,240,${Math.random() * 0.15})`;
            ctx.beginPath();
            ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 2 + 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function applyLightLeak(ctx, w, h) {
        const gradient = ctx.createLinearGradient(0, 0, w * 0.4, h * 0.3);
        gradient.addColorStop(0, 'rgba(255,140,0,0.2)');
        gradient.addColorStop(0.5, 'rgba(255,80,0,0.1)');
        gradient.addColorStop(1, 'rgba(255,140,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }

    function applyFlashGlare(ctx, w, h) {
        const gradient = ctx.createRadialGradient(w*0.5, h*0.35, 0, w*0.5, h*0.35, w*0.4);
        gradient.addColorStop(0, 'rgba(255,255,200,0.08)');
        gradient.addColorStop(1, 'rgba(255,255,200,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
    }

    function blurEdges(data, w, h, strength) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const dx = (x - w/2) / (w/2);
                const dy = (y - h/2) / (h/2);
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist > 0.6) {
                    const factor = 1 - (dist - 0.6) * strength * 2;
                    const i = (y * w + x) * 4;
                    data[i] = clamp(data[i] * factor);
                    data[i+1] = clamp(data[i+1] * factor);
                    data[i+2] = clamp(data[i+2] * factor);
                }
            }
        }
    }

    // ==================== HELPERS ====================

    function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
    function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

    function createThumbnail(canvas, size) {
        const tmp = document.createElement('canvas');
        const aspect = canvas.width / canvas.height;
        if (aspect > 1) { tmp.width = size; tmp.height = size / aspect; }
        else { tmp.height = size; tmp.width = size * aspect; }
        tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
        return tmp.toDataURL('image/jpeg', 0.6);
    }

    function showToast(msg) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 2000);
        setTimeout(() => toast.remove(), 2500);
    }

    // ==================== NAVIGATION ====================

    function showResult() {
        cameraView.style.display = 'none';
        galleryView.classList.add('hidden');
        editorView.classList.add('hidden');
        resultView.classList.remove('hidden');
    }

    function showCamera() {
        resultView.classList.add('hidden');
        galleryView.classList.add('hidden');
        editorView.classList.add('hidden');
        sendModal.classList.add('hidden');
        cameraView.style.display = 'flex';
    }

    function showGallery() {
        cameraView.style.display = 'none';
        resultView.classList.add('hidden');
        editorView.classList.add('hidden');
        galleryView.classList.remove('hidden');
        renderGallery();
    }

    function showEditor() {
        resultView.classList.add('hidden');
        cameraView.style.display = 'none';
        editorView.classList.remove('hidden');
        initEditor();
    }

    $('btn-back').addEventListener('click', showCamera);
    $('btn-retake').addEventListener('click', showCamera);
    $('btn-gallery').addEventListener('click', showGallery);
    $('btn-gallery-back').addEventListener('click', showCamera);

    // ==================== SAVE / DOWNLOAD ====================

    $('btn-save').addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `timelens_${currentEra}_${Date.now()}.jpg`;
        link.href = resultCanvas.toDataURL('image/jpeg', 0.92);
        link.click();
        showToast('Foto guardada');
    });

    // ==================== SHARE (native) ====================

    $('btn-share').addEventListener('click', async () => {
        try {
            resultCanvas.toBlob(async (blob) => {
                const file = new File([blob], 'timelens_photo.jpg', { type: 'image/jpeg' });
                if (navigator.share) {
                    await navigator.share({ title: 'TimeLens - Foto del Pasado', files: [file] });
                } else {
                    const link = document.createElement('a');
                    link.download = `timelens_${currentEra}_${Date.now()}.jpg`;
                    link.href = URL.createObjectURL(blob);
                    link.click();
                }
            }, 'image/jpeg', 0.92);
        } catch (err) {
            console.log('Share cancelled:', err);
        }
    });

    // ==================== SEND MODAL ====================

    $('btn-send-edit').addEventListener('click', () => {
        sendModal.classList.remove('hidden');
    });

    $('btn-close-modal').addEventListener('click', () => {
        sendModal.classList.add('hidden');
    });

    sendModal.addEventListener('click', (e) => {
        if (e.target === sendModal) sendModal.classList.add('hidden');
    });

    // Send option handlers
    document.querySelectorAll('.send-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            handleSendAction(action);
        });
    });

    function handleSendAction(action) {
        resultCanvas.toBlob(async (blob) => {
            const file = new File([blob], 'timelens_photo.jpg', { type: 'image/jpeg' });

            switch (action) {
                case 'whatsapp': {
                    // On mobile, use native share targeting WhatsApp if possible
                    if (navigator.share) {
                        try {
                            await navigator.share({ files: [file] });
                        } catch (e) { /* cancelled */ }
                    } else {
                        // Fallback: download then user can attach manually
                        downloadBlob(blob);
                        showToast('Foto descargada - enviala por WhatsApp');
                    }
                    break;
                }
                case 'instagram': {
                    // Instagram doesn't support direct web sharing of images
                    // Download and user can share from camera roll
                    if (navigator.share) {
                        try {
                            await navigator.share({ files: [file] });
                        } catch (e) { /* cancelled */ }
                    } else {
                        downloadBlob(blob);
                        showToast('Foto descargada - compartela en Instagram');
                    }
                    break;
                }
                case 'email': {
                    if (navigator.share) {
                        try {
                            await navigator.share({
                                title: 'TimeLens - Foto del Pasado',
                                text: 'Mira esta foto vintage que hice con TimeLens!',
                                files: [file]
                            });
                        } catch (e) { /* cancelled */ }
                    } else {
                        downloadBlob(blob);
                        showToast('Foto descargada - adjuntala al email');
                    }
                    break;
                }
                case 'copy': {
                    try {
                        await navigator.clipboard.write([
                            new ClipboardItem({ 'image/png': blob })
                        ]);
                        showToast('Foto copiada al portapapeles');
                    } catch (e) {
                        downloadBlob(blob);
                        showToast('No se pudo copiar - foto descargada');
                    }
                    break;
                }
                case 'more': {
                    if (navigator.share) {
                        try {
                            await navigator.share({
                                title: 'TimeLens - Foto del Pasado',
                                files: [file]
                            });
                        } catch (e) { /* cancelled */ }
                    } else {
                        downloadBlob(blob);
                        showToast('Foto descargada');
                    }
                    break;
                }
            }

            sendModal.classList.add('hidden');
        }, 'image/jpeg', 0.92);
    }

    function downloadBlob(blob) {
        const link = document.createElement('a');
        link.download = `timelens_${currentEra}_${Date.now()}.jpg`;
        link.href = URL.createObjectURL(blob);
        link.click();
    }

    // ==================== GALLERY ====================

    function saveGallery() {
        try {
            localStorage.setItem('timelens_gallery', JSON.stringify(gallery));
        } catch (e) {
            gallery.pop();
            try { localStorage.setItem('timelens_gallery', JSON.stringify(gallery)); } catch(e2) {}
        }
    }

    function updateGalleryThumb() {
        if (gallery.length > 0) {
            galleryThumb.style.backgroundImage = `url(${gallery[0].thumb})`;
        }
    }

    function renderGallery() {
        if (gallery.length === 0) {
            galleryGrid.classList.add('hidden');
            galleryEmpty.classList.remove('hidden');
            return;
        }
        galleryGrid.classList.remove('hidden');
        galleryEmpty.classList.add('hidden');
        galleryGrid.innerHTML = gallery.map((item, i) =>
            `<div class="gallery-item" data-index="${i}" style="background-image:url(${item.thumb})"></div>`
        ).join('');
    }

    galleryGrid.addEventListener('click', (e) => {
        const item = e.target.closest('.gallery-item');
        if (!item) return;
        const idx = parseInt(item.dataset.index);
        const photo = gallery[idx];
        if (!photo) return;

        const img = new Image();
        img.onload = () => {
            resultCanvas.width = img.width;
            resultCanvas.height = img.height;
            resultCanvas.getContext('2d').drawImage(img, 0, 0);
            dateStamp.textContent = photo.date;
            showResult();
        };
        img.src = photo.full;
    });

    $('btn-clear-gallery').addEventListener('click', () => {
        if (!confirm('Borrar todas las fotos?')) return;
        gallery = [];
        saveGallery();
        galleryThumb.style.backgroundImage = '';
        renderGallery();
    });

    // ==================== NANO BANANA EDITOR ====================

    $('btn-edit-nano').addEventListener('click', showEditor);
    $('btn-editor-cancel').addEventListener('click', () => {
        clearEditorOverlays();
        showResult();
    });

    $('btn-editor-done').addEventListener('click', () => {
        flattenEditorToResult();
        showResult();
    });

    function initEditor() {
        // Copy result canvas into editor
        const w = resultCanvas.width;
        const h = resultCanvas.height;
        editorCanvas.width = w;
        editorCanvas.height = h;
        drawCanvas.width = w;
        drawCanvas.height = h;

        const ectx = editorCanvas.getContext('2d');
        ectx.drawImage(resultCanvas, 0, 0);

        editorBaseImage = ectx.getImageData(0, 0, w, h);
        drawHistory = [];

        const dctx = drawCanvas.getContext('2d');
        dctx.clearRect(0, 0, w, h);

        // Size canvases to fit
        sizeEditorCanvases();

        // Reset sliders
        $('slider-brightness').value = 0; $('val-brightness').textContent = '0';
        $('slider-contrast').value = 0; $('val-contrast').textContent = '0';
        $('slider-saturation').value = 0; $('val-saturation').textContent = '0';

        // Clear overlays
        clearEditorOverlays();

        // Show adjust panel by default
        setActiveTool('adjust');
    }

    function sizeEditorCanvases() {
        const wrap = document.querySelector('.editor-canvas-wrap');
        const wrapW = wrap.clientWidth;
        const wrapH = wrap.clientHeight;
        const cw = editorCanvas.width;
        const ch = editorCanvas.height;
        const scale = Math.min(wrapW / cw, wrapH / ch, 1);
        const dispW = Math.round(cw * scale);
        const dispH = Math.round(ch * scale);

        editorCanvas.style.width = dispW + 'px';
        editorCanvas.style.height = dispH + 'px';
        drawCanvas.style.width = dispW + 'px';
        drawCanvas.style.height = dispH + 'px';
    }

    function clearEditorOverlays() {
        document.querySelectorAll('.sticker-floating, .text-floating').forEach(el => el.remove());
    }

    // Tool switching
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveTool(btn.dataset.tool);
        });
    });

    function setActiveTool(tool) {
        activeTool = tool;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        document.querySelectorAll('.tool-panel').forEach(p => p.classList.add('hidden'));
        const panel = $('panel-' + tool);
        if (panel) panel.classList.remove('hidden');

        // Toggle draw canvas pointer events
        drawCanvas.style.pointerEvents = (tool === 'draw') ? 'auto' : 'none';
    }

    // === ADJUST SLIDERS ===
    ['brightness', 'contrast', 'saturation'].forEach(name => {
        const slider = $('slider-' + name);
        const valEl = $('val-' + name);
        slider.addEventListener('input', () => {
            valEl.textContent = slider.value;
            applyAdjustments();
        });
    });

    function applyAdjustments() {
        if (!editorBaseImage) return;
        const brightness = parseInt($('slider-brightness').value);
        const contrast = parseInt($('slider-contrast').value);
        const saturation = parseInt($('slider-saturation').value);

        const ectx = editorCanvas.getContext('2d');
        const newData = new ImageData(
            new Uint8ClampedArray(editorBaseImage.data),
            editorBaseImage.width,
            editorBaseImage.height
        );
        const d = newData.data;

        const contFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        for (let i = 0; i < d.length; i += 4) {
            // Brightness
            let r = d[i] + brightness;
            let g = d[i+1] + brightness;
            let b = d[i+2] + brightness;

            // Contrast
            r = contFactor * (r - 128) + 128;
            g = contFactor * (g - 128) + 128;
            b = contFactor * (b - 128) + 128;

            // Saturation
            if (saturation !== 0) {
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                const sat = 1 + saturation / 100;
                r = gray + sat * (r - gray);
                g = gray + sat * (g - gray);
                b = gray + sat * (b - gray);
            }

            d[i] = Math.max(0, Math.min(255, Math.round(r)));
            d[i+1] = Math.max(0, Math.min(255, Math.round(g)));
            d[i+2] = Math.max(0, Math.min(255, Math.round(b)));
        }

        ectx.putImageData(newData, 0, 0);
    }

    // === DRAW TOOL ===
    function getDrawPos(e) {
        const rect = drawCanvas.getBoundingClientRect();
        const scaleX = drawCanvas.width / rect.width;
        const scaleY = drawCanvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    drawCanvas.addEventListener('pointerdown', (e) => {
        if (activeTool !== 'draw') return;
        isDrawing = true;
        const pos = getDrawPos(e);
        const dctx = drawCanvas.getContext('2d');
        dctx.beginPath();
        dctx.moveTo(pos.x, pos.y);
        dctx.strokeStyle = drawColor;
        dctx.lineWidth = drawSize * (drawCanvas.width / drawCanvas.getBoundingClientRect().width);
        dctx.lineCap = 'round';
        dctx.lineJoin = 'round';
        // Save state for undo
        drawHistory.push(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
        if (drawHistory.length > 30) drawHistory.shift();
    });

    drawCanvas.addEventListener('pointermove', (e) => {
        if (!isDrawing) return;
        const pos = getDrawPos(e);
        const dctx = drawCanvas.getContext('2d');
        dctx.lineTo(pos.x, pos.y);
        dctx.stroke();
    });

    drawCanvas.addEventListener('pointerup', () => { isDrawing = false; });
    drawCanvas.addEventListener('pointerleave', () => { isDrawing = false; });

    // Draw colors
    document.querySelectorAll('.draw-colors:not(.text-colors) .color-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            document.querySelectorAll('.draw-colors:not(.text-colors) .color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            drawColor = dot.dataset.color;
        });
    });

    // Draw sizes
    document.querySelectorAll('.size-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            document.querySelectorAll('.size-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            drawSize = parseInt(dot.dataset.size);
        });
    });

    // Draw undo
    $('btn-draw-undo').addEventListener('click', () => {
        if (drawHistory.length === 0) return;
        const prev = drawHistory.pop();
        drawCanvas.getContext('2d').putImageData(prev, 0, 0);
    });

    // === TEXT TOOL ===
    document.querySelectorAll('.text-colors .color-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            document.querySelectorAll('.text-colors .color-dot').forEach(d => d.classList.remove('active'));
            dot.classList.add('active');
            textColor = dot.dataset.tcolor;
        });
    });

    $('btn-place-text').addEventListener('click', () => {
        const text = $('text-input').value.trim();
        if (!text) return;
        const size = parseInt($('slider-text-size').value);

        const wrap = document.querySelector('.editor-canvas-wrap');
        const el = document.createElement('div');
        el.className = 'text-floating';
        el.textContent = text;
        el.style.fontSize = size + 'px';
        el.style.color = textColor;
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.transform = 'translate(-50%, -50%)';
        wrap.appendChild(el);

        makeDraggable(el, wrap);
        $('text-input').value = '';
    });

    // === STICKERS ===
    document.querySelectorAll('.sticker-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const sticker = btn.dataset.sticker;
            const wrap = document.querySelector('.editor-canvas-wrap');
            const el = document.createElement('div');
            el.className = 'sticker-floating';
            el.textContent = sticker;
            el.style.left = '50%';
            el.style.top = '50%';
            el.style.transform = 'translate(-50%, -50%)';
            wrap.appendChild(el);

            makeDraggable(el, wrap);
        });
    });

    function makeDraggable(el, container) {
        let offsetX = 0, offsetY = 0, isDragging = false;

        function onStart(e) {
            isDragging = true;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const rect = el.getBoundingClientRect();
            offsetX = clientX - rect.left;
            offsetY = clientY - rect.top;
            el.style.transform = 'none';
            e.preventDefault();
        }
        function onMove(e) {
            if (!isDragging) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            const cRect = container.getBoundingClientRect();
            el.style.left = (clientX - cRect.left - offsetX) + 'px';
            el.style.top = (clientY - cRect.top - offsetY) + 'px';
            e.preventDefault();
        }
        function onEnd() { isDragging = false; }

        el.addEventListener('pointerdown', onStart);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onEnd);
    }

    // === ROTATE / FLIP ===
    $('btn-rotate-left').addEventListener('click', () => rotateEditor(-90));
    $('btn-rotate-right').addEventListener('click', () => rotateEditor(90));
    $('btn-flip-h').addEventListener('click', () => flipEditor('h'));
    $('btn-flip-v').addEventListener('click', () => flipEditor('v'));

    function rotateEditor(deg) {
        const ectx = editorCanvas.getContext('2d');
        const w = editorCanvas.width;
        const h = editorCanvas.height;
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = w;
        tmpCanvas.height = h;
        tmpCanvas.getContext('2d').drawImage(editorCanvas, 0, 0);

        editorCanvas.width = h;
        editorCanvas.height = w;
        const ctx = editorCanvas.getContext('2d');
        ctx.save();
        if (deg === 90) {
            ctx.translate(h, 0);
            ctx.rotate(Math.PI / 2);
        } else {
            ctx.translate(0, w);
            ctx.rotate(-Math.PI / 2);
        }
        ctx.drawImage(tmpCanvas, 0, 0);
        ctx.restore();

        // Also rotate draw canvas
        const dtmp = document.createElement('canvas');
        dtmp.width = w;
        dtmp.height = h;
        dtmp.getContext('2d').drawImage(drawCanvas, 0, 0);
        drawCanvas.width = h;
        drawCanvas.height = w;
        const dctx = drawCanvas.getContext('2d');
        dctx.save();
        if (deg === 90) {
            dctx.translate(h, 0);
            dctx.rotate(Math.PI / 2);
        } else {
            dctx.translate(0, w);
            dctx.rotate(-Math.PI / 2);
        }
        dctx.drawImage(dtmp, 0, 0);
        dctx.restore();

        // Update base image
        editorBaseImage = editorCanvas.getContext('2d').getImageData(0, 0, editorCanvas.width, editorCanvas.height);
        drawHistory = [];
        sizeEditorCanvases();
    }

    function flipEditor(axis) {
        const ectx = editorCanvas.getContext('2d');
        const w = editorCanvas.width;
        const h = editorCanvas.height;
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = w;
        tmpCanvas.height = h;
        tmpCanvas.getContext('2d').drawImage(editorCanvas, 0, 0);

        ectx.save();
        if (axis === 'h') {
            ectx.translate(w, 0);
            ectx.scale(-1, 1);
        } else {
            ectx.translate(0, h);
            ectx.scale(1, -1);
        }
        ectx.drawImage(tmpCanvas, 0, 0);
        ectx.restore();

        // Also flip draw canvas
        const dtmp = document.createElement('canvas');
        dtmp.width = w;
        dtmp.height = h;
        dtmp.getContext('2d').drawImage(drawCanvas, 0, 0);
        const dctx = drawCanvas.getContext('2d');
        dctx.save();
        if (axis === 'h') {
            dctx.translate(w, 0);
            dctx.scale(-1, 1);
        } else {
            dctx.translate(0, h);
            dctx.scale(1, -1);
        }
        dctx.drawImage(dtmp, 0, 0);
        dctx.restore();

        editorBaseImage = editorCanvas.getContext('2d').getImageData(0, 0, w, h);
        drawHistory = [];
    }

    // === FLATTEN EDITOR TO RESULT ===
    function flattenEditorToResult() {
        const w = editorCanvas.width;
        const h = editorCanvas.height;
        resultCanvas.width = w;
        resultCanvas.height = h;
        const ctx = resultCanvas.getContext('2d');

        // Draw base (adjusted) image
        ctx.drawImage(editorCanvas, 0, 0);

        // Draw drawing layer
        ctx.drawImage(drawCanvas, 0, 0);

        // Draw floating stickers and text
        const wrap = document.querySelector('.editor-canvas-wrap');
        const canvasRect = editorCanvas.getBoundingClientRect();
        const scaleX = w / canvasRect.width;
        const scaleY = h / canvasRect.height;

        document.querySelectorAll('.sticker-floating').forEach(el => {
            const elRect = el.getBoundingClientRect();
            const x = (elRect.left - canvasRect.left) * scaleX;
            const y = (elRect.top - canvasRect.top) * scaleY;
            const fontSize = parseFloat(getComputedStyle(el).fontSize) * scaleX;
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(el.textContent, x, y);
        });

        document.querySelectorAll('.text-floating').forEach(el => {
            const elRect = el.getBoundingClientRect();
            const x = (elRect.left - canvasRect.left) * scaleX;
            const y = (elRect.top - canvasRect.top) * scaleY;
            const fontSize = parseFloat(getComputedStyle(el).fontSize) * scaleX;
            ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            ctx.fillStyle = el.style.color;
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            ctx.shadowBlur = 6 * scaleX;
            ctx.shadowOffsetX = 2 * scaleX;
            ctx.shadowOffsetY = 2 * scaleY;
            ctx.textBaseline = 'top';
            ctx.fillText(el.textContent, x, y);
            ctx.shadowColor = 'transparent';
        });

        clearEditorOverlays();

        // Update gallery with edited version
        if (gallery.length > 0) {
            gallery[0].full = resultCanvas.toDataURL('image/jpeg', 0.85);
            gallery[0].thumb = createThumbnail(resultCanvas, 300);
            saveGallery();
            updateGalleryThumb();
        }

        showToast('Edicion aplicada');
    }

    // ==================== SERVICE WORKER ====================
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
})();
