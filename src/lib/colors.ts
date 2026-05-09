// ── RGB → HSL ─────────────────────────────────────────────────────────────
function rgbToHsl(r255: number, g255: number, b255: number): [number, number, number] {
	const r = r255 / 255, g = g255 / 255, b = b255 / 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return [Math.round(h * 60) % 360, s, l];
}

// ── Known provider brand hues (TMDB provider_id → hue °) ─────────────────
// Covers the most common US streaming services so colors are recognisable
// without relying on canvas/CORS extraction.
const BRAND_HUES: Record<number, number> = {
	8:    4,   // Netflix           — red
	9:    200, // Amazon Prime Video — light blue
	10:   200, // Amazon Video       — light blue
	15:   145, // Hulu               — green
	37:   4,   // Showtime           — red
	78:   35,  // Peacock Premium    — orange
	119:  200, // Amazon Prime       — light blue
	337:  222, // Disney+            — blue
	350:  210, // Apple TV+          — slate blue
	372:  4,   // ESPN+              — red
	384:  268, // HBO Max            — purple
	386:  35,  // Peacock            — orange
	531:  225, // Paramount+         — blue
	584:  205, // Discovery+         — blue
	1899: 268, // Max                — purple
};

// ── Fallback: deterministic hue from provider_id ──────────────────────────
export function providerHue(providerId: number): number {
	return BRAND_HUES[providerId] ?? Math.round((providerId * 137.508) % 360);
}

// ── Logo colour extraction ────────────────────────────────────────────────
// In-memory cache so we don't hit the canvas API repeatedly in one session
const memCache = new Map<string, number>(); // logo_path → hue

/**
 * Extract the most visually prominent (highest-saturation) hue from a
 * provider logo. Results are persisted in localStorage so extraction only
 * happens once per logo across sessions.
 *
 * Returns -1 on failure (CORS blocked, load error, monochrome logo, etc.)
 * so callers can fall back to providerHue().
 */
export async function extractLogoHue(logoPath: string, tmdbImgBase: string): Promise<number> {
	if (memCache.has(logoPath)) return memCache.get(logoPath)!;

	// Check persisted cache first
	try {
		const raw = localStorage.getItem('sq:logoHues');
		if (raw) {
			const stored: Record<string, number> = JSON.parse(raw);
			if (logoPath in stored) {
				memCache.set(logoPath, stored[logoPath]);
				return stored[logoPath];
			}
		}
	} catch {}

	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';

		img.onload = () => {
			try {
				const SIZE = 48; // downsample — fast and sufficient
				const canvas = document.createElement('canvas');
				canvas.width = SIZE; canvas.height = SIZE;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0, SIZE, SIZE);
				const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

				// Find the pixel with the highest "vibrancy" score:
				// saturation weighted against extreme lightness (avoids near-white/black)
				let bestHue = -1, bestScore = 0;
				for (let i = 0; i < data.length; i += 4) {
					if (data[i + 3] < 128) continue; // skip transparent
					const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
					const score = s * (1 - Math.abs(l - 0.5) * 1.8);
					if (score > bestScore) { bestScore = score; bestHue = h; }
				}

				const hue = bestScore > 0.1 ? bestHue : -1; // -1 for near-monochrome logos

				// Only cache and persist successful extractions
				if (hue >= 0) {
					memCache.set(logoPath, hue);
					try {
						const raw = localStorage.getItem('sq:logoHues');
						const stored: Record<string, number> = raw ? JSON.parse(raw) : {};
						stored[logoPath] = hue;
						localStorage.setItem('sq:logoHues', JSON.stringify(stored));
					} catch {}
				}

				resolve(hue);
			} catch {
				// SecurityError if CORS fails at canvas read time
				resolve(-1);
			}
		};

		img.onerror = () => resolve(-1);
		img.src = `${tmdbImgBase}/w92${logoPath}`;
	});
}

// ── Lane colour palette from a known hue ─────────────────────────────────
export function laneColors(hue: number | null): {
	row: string;
	header: string;
	border: string;
	barGradient: string;
	barStroke: string;
	labelText: string;
} {
	if (hue === null) {
		return {
			row:         'hsl(0 0% 7%)',
			header:      'hsl(0 0% 10%)',
			border:      '3px solid hsl(0 0% 22%)',
			barGradient: 'linear-gradient(to right, hsl(0 0% 24%), hsl(0 0% 16%))',
			barStroke:   '1px solid hsl(0 0% 32%)',
			labelText:   'hsl(0 0% 55%)'
		};
	}
	const h = hue;
	return {
		row:         `hsl(${h} 25% 7%)`,
		header:      `hsl(${h} 28% 11%)`,
		border:      `3px solid hsl(${h} 65% 42%)`,
		barGradient: `linear-gradient(to right, hsl(${h} 58% 30%), hsl(${h} 42% 20%))`,
		barStroke:   `1px solid hsl(${h} 72% 52%)`,
		labelText:   `hsl(${h} 60% 72%)`
	};
}
