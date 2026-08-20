// Thin wrapper around the `qrcode` package (#147) — this app's first runtime
// dependency. Kept to one function so the rest of the codebase only ever
// imports this, not the library directly.
import QRCode from 'qrcode';

/**
 * Renders `text` as an inline SVG string. Generated entirely client-side —
 * an invite link's DEK never needs to leave the browser to become a QR code,
 * same as it never needs to leave the browser to become a copyable link.
 */
export async function toQrSvg(text: string): Promise<string> {
	return QRCode.toString(text, { type: 'svg', margin: 1, width: 200 });
}
