import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { apiError, checkSameOrigin } from '$lib/server/api';
import type { RequestHandler } from './$types';

const REPO = 'zenfinity/queuest';
const GITHUB_API = `https://api.github.com/repos/${REPO}/issues`;
const TITLE_MAX = 200;
const BODY_MAX = 5_000;

export const POST: RequestHandler = async ({ request }) => {
	const originError = checkSameOrigin(request);
	if (originError) return originError;

	const GITHUB_TOKEN = env.GITHUB_TOKEN;
	if (!GITHUB_TOKEN) {
		return apiError(503, 'Feedback not configured');
	}

	let title: unknown, body: unknown;
	try {
		({ title, body } = await request.json());
	} catch {
		return apiError(400, 'Invalid JSON');
	}

	if (typeof title !== 'string') return apiError(400, 'Title must be a string');
	if (!title.trim()) return apiError(400, 'Title is required');
	if (title.length > TITLE_MAX) return apiError(400, 'Title too long');
	if (body !== undefined && (typeof body !== 'string' || body.length > BODY_MAX))
		return apiError(400, 'Body too long');

	const res = await fetch(GITHUB_API, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${GITHUB_TOKEN}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			'Content-Type': 'application/json',
			'User-Agent': 'Queuest-App'
		},
		body: JSON.stringify({
			title: title.trim().slice(0, TITLE_MAX),
			body: body?.trim().slice(0, BODY_MAX) || undefined,
			labels: ['feedback']
		})
	});

	if (!res.ok) {
		// Don't leak upstream error details to the client
		return apiError(502, 'Could not submit feedback. Please try again.');
	}

	const issue = await res.json();
	return json({ url: issue.html_url, number: issue.number });
};
