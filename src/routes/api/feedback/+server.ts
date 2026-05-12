import { json, error } from '@sveltejs/kit';
import { GITHUB_TOKEN } from '$env/static/private';
import type { RequestHandler } from './$types';

const REPO = 'zenfinity/streamq';
const GITHUB_API = `https://api.github.com/repos/${REPO}/issues`;

export const POST: RequestHandler = async ({ request }) => {
	if (!GITHUB_TOKEN) {
		throw error(503, 'Feedback not configured');
	}

	const { title, body } = await request.json();
	if (!title?.trim()) throw error(400, 'Title is required');

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
			title: title.trim(),
			body: body?.trim() || undefined,
			labels: ['feedback']
		})
	});

	if (!res.ok) {
		const msg = await res.text().catch(() => res.statusText);
		throw error(res.status, `GitHub API error: ${msg}`);
	}

	const issue = await res.json();
	return json({ url: issue.html_url, number: issue.number });
};
