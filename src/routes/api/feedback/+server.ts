import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const REPO = 'zenfinity/streamq';
const GITHUB_API = `https://api.github.com/repos/${REPO}/issues`;
const TITLE_MAX = 200;
const BODY_MAX = 5_000;

export const POST: RequestHandler = async ({ request }) => {
	// Same-origin guard
	const fetchSite = request.headers.get('Sec-Fetch-Site');
	if (fetchSite && fetchSite !== 'same-origin') {
		throw error(403, 'Forbidden');
	}

	const GITHUB_TOKEN = env.GITHUB_TOKEN;
	if (!GITHUB_TOKEN) {
		throw error(503, 'Feedback not configured');
	}

	const { title, body } = await request.json();
	if (!title?.trim()) throw error(400, 'Title is required');
	if (typeof title !== 'string' || title.length > TITLE_MAX) throw error(400, 'Title too long');
	if (body !== undefined && (typeof body !== 'string' || body.length > BODY_MAX))
		throw error(400, 'Body too long');

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
		throw error(502, 'Could not submit feedback. Please try again.');
	}

	const issue = await res.json();
	return json({ url: issue.html_url, number: issue.number });
};
