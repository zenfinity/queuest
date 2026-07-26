// btoa/atob are available in both the browser and Cloudflare's Workers
// runtime, so this is safe to import from client code (crypto.ts) and
// server routes (api/share/+server.ts) alike.

export function b64urlEncode(bytes: Uint8Array<ArrayBuffer>): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
	const pad = (4 - (b64.length % 4)) % 4;
	const str = atob(b64 + '='.repeat(pad));
	const buf = new ArrayBuffer(str.length);
	const out = new Uint8Array(buf);
	for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
	return out;
}
