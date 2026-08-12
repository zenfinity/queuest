// CompressionStream/DecompressionStream('gzip') is available in every
// browser this app targets and in the Node test environment (18+) — no
// polyfill/dependency needed. Used by the sync engine (#101) to shrink the
// JSON payload before encrypting: ~500 items with full metadata is ~1.5 MB
// raw.

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out as Uint8Array<ArrayBuffer>;
}

export async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const cs = new CompressionStream('gzip');
	const writer = cs.writable.getWriter();
	// Don't await write() before close() — no backpressure to wait on here,
	// and awaiting would serialize what readAll() below already drains concurrently.
	void writer.write(bytes);
	void writer.close();
	return readAll(cs.readable);
}

export async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const ds = new DecompressionStream('gzip');
	const writer = ds.writable.getWriter();
	void writer.write(bytes);
	void writer.close();
	return readAll(ds.readable);
}
