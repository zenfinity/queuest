// ── Known provider brand hues (TMDB provider_id → hue °) ─────────────────
// Covers the most common US streaming services so colors are recognisable
// without relying on canvas/CORS extraction.
const BRAND_HUES: Record<number, number> = {
	8: 4, // Netflix           — red
	9: 200, // Amazon Prime Video — light blue
	10: 200, // Amazon Video       — light blue
	15: 145, // Hulu               — green
	37: 4, // Showtime           — red
	78: 35, // Peacock Premium    — orange
	119: 200, // Amazon Prime       — light blue
	337: 222, // Disney+            — blue
	350: 210, // Apple TV+          — slate blue
	372: 4, // ESPN+              — red
	384: 268, // HBO Max            — purple
	386: 35, // Peacock            — orange
	531: 225, // Paramount+         — blue
	584: 205, // Discovery+         — blue
	1899: 268 // Max                — purple
};

// ── Fallback: deterministic hue from provider_id ──────────────────────────
export function providerHue(providerId: number): number {
	return BRAND_HUES[providerId] ?? Math.round((providerId * 137.508) % 360);
}

// ── Best available hue for a provider id, or null if there isn't one ──────
export function resolvedHue(providerId: number | null): number | null {
	return providerId !== null ? providerHue(providerId) : null;
}

// ── Hue extraction from a user-chosen collection color (hex, e.g. "#ef4444") ──
// Deliberately a separate path from providerHue/resolvedHue above, not a
// shared lookup: provider lanes are branded hues from a curated table,
// collection lanes are whatever hex the user picked (palette or custom via
// the Settings color input) — conflating them would make e.g. an orange
// collection look like it's on a provider. Only the HSL-based rendering in
// laneColors() is shared between the two.
export function hexToHue(hex: string): number | null {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex);
	if (!m) return null;
	const r = parseInt(m[1].slice(0, 2), 16) / 255;
	const g = parseInt(m[1].slice(2, 4), 16) / 255;
	const b = parseInt(m[1].slice(4, 6), 16) / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d === 0) return 0; // achromatic (gray) — hue is meaningless but must return a number
	let h: number;
	switch (max) {
		case r:
			h = ((g - b) / d) % 6;
			break;
		case g:
			h = (b - r) / d + 2;
			break;
		default:
			h = (r - g) / d + 4;
	}
	h *= 60;
	return h < 0 ? h + 360 : h;
}

// ── Lane colour palette from a known hue ─────────────────────────────────
export function laneColors(
	hue: number | null,
	dark = true
): {
	row: string;
	header: string;
	border: string;
	barGradient: string;
	barStroke: string;
	labelText: string;
} {
	if (dark) {
		if (hue === null) {
			return {
				row: 'hsl(0 0% 7%)',
				header: 'hsl(0 0% 10%)',
				border: '3px solid hsl(0 0% 22%)',
				barGradient: 'linear-gradient(to right, hsl(0 0% 24%), hsl(0 0% 16%))',
				barStroke: '1px solid hsl(0 0% 32%)',
				labelText: 'hsl(0 0% 55%)'
			};
		}
		const h = hue;
		return {
			row: `hsl(${h} 25% 7%)`,
			header: `hsl(${h} 28% 11%)`,
			border: `3px solid hsl(${h} 65% 42%)`,
			barGradient: `linear-gradient(to right, hsl(${h} 58% 30%), hsl(${h} 42% 20%))`,
			barStroke: `1px solid hsl(${h} 72% 52%)`,
			labelText: `hsl(${h} 60% 72%)`
		};
	} else {
		// Light mode — pale tinted rows, vibrant bars, dark label text
		if (hue === null) {
			return {
				row: 'hsl(0 0% 95%)',
				header: 'hsl(0 0% 91%)',
				border: '3px solid hsl(0 0% 65%)',
				barGradient: 'linear-gradient(to right, hsl(0 0% 52%), hsl(0 0% 42%))',
				barStroke: '1px solid hsl(0 0% 62%)',
				labelText: 'hsl(0 0% 30%)'
			};
		}
		const h = hue;
		return {
			row: `hsl(${h} 40% 95%)`,
			header: `hsl(${h} 35% 90%)`,
			border: `3px solid hsl(${h} 65% 42%)`,
			barGradient: `linear-gradient(to right, hsl(${h} 58% 38%), hsl(${h} 42% 28%))`,
			barStroke: `1px solid hsl(${h} 72% 52%)`,
			labelText: `hsl(${h} 55% 28%)`
		};
	}
}
