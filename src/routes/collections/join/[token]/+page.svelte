<script lang="ts">
	// Invite redemption (#189). Joining is never automatic on link-open: the
	// recipient is always shown who invited them to what and has to accept.
	// That confirm step is the security control (no drive-by joins from a link
	// pasted into a group chat) and the UX at the same time.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { joinCollection } from '$lib/collection-actions';
	import { isSyncEnabled } from '$lib/sync';

	const token = page.params.token ?? '';

	type Preview = { collectionName: string; invitedBy: string; expiresAt: string };

	let loading = $state(true);
	let preview = $state<Preview | null>(null);
	let loadError = $state('');
	let busy = $state(false);
	let joinError = $state('');
	let needsSync = $state(false);
	let joined = $state(false);

	// The Collection DEK rides in the URL fragment, which browsers never send
	// to the server — read it here, in the only place it is ever seen.
	let dek = '';

	onMount(async () => {
		dek = window.location.hash.replace(/^#/, '');
		needsSync = !(await isSyncEnabled());

		try {
			const res = await fetch(`/api/collections/invites/${encodeURIComponent(token)}`);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				loadError = body.error ?? 'This invite link is not valid.';
				return;
			}
			preview = (await res.json()) as Preview;
		} catch {
			loadError = 'Could not check this invite. Check your connection and try again.';
		} finally {
			loading = false;
		}
	});

	async function accept() {
		if (!dek) {
			joinError =
				'This link is missing its key — it was probably shortened or truncated. Ask for a fresh one.';
			return;
		}
		const result = await joinCollection(token, dek, {
			setBusy: (b) => (busy = b),
			setError: (e) => (joinError = e)
		});
		if (result) {
			joined = true;
			await goto(resolve('/app'));
		}
	}
</script>

<svelte:head><title>Queuest — Join a list</title></svelte:head>

<div class="mx-auto max-w-md space-y-6 py-10">
	<h1 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Shared list</h1>

	{#if loading}
		<div class="space-y-3">
			<div class="h-6 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800"></div>
			<div class="h-4 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800"></div>
		</div>
	{:else if loadError}
		<div
			class="rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900"
		>
			<p class="mb-2 text-3xl">🔗</p>
			<p class="text-sm text-gray-700 dark:text-gray-300">{loadError}</p>
			<a
				href={resolve('/app')}
				class="mt-4 inline-block rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
				>Go to your queue</a
			>
		</div>
	{:else if preview}
		<div
			class="space-y-4 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
		>
			<div>
				<p class="text-sm text-gray-600 dark:text-gray-400">
					<span class="font-medium text-gray-900 dark:text-white">{preview.invitedBy}</span>
					invited you to
				</p>
				<p class="mt-1 text-xl font-bold tracking-tight">{preview.collectionName}</p>
			</div>

			<p class="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
				You'll both be able to add titles and track what you've watched. Everything in the list is
				encrypted — we can't read it.
			</p>

			{#if needsSync}
				<!-- Joining stores a copy of the collection key wrapped under this
				     account's own key, so there has to be an account first. -->
				<div
					class="rounded-lg bg-orange-50 p-4 text-sm text-orange-800 dark:bg-orange-950/20 dark:text-orange-300"
				>
					<p class="font-medium">You'll need sync turned on first</p>
					<p class="mt-1 leading-relaxed">
						Shared lists need an account so your copy of the key can be stored securely.
					</p>
					<a
						href={resolve('/settings#sync')}
						class="mt-3 inline-block rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white"
						>Set up sync</a
					>
				</div>
			{:else}
				<button
					onclick={accept}
					disabled={busy || joined}
					class="w-full rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				>
					{busy ? 'Joining…' : `Join ${preview.collectionName}`}
				</button>
			{/if}

			{#if joinError}
				<p class="text-sm text-red-500">{joinError}</p>
			{/if}

			<p class="text-xs text-gray-400">
				This invite is single-use and expires {new Date(preview.expiresAt).toLocaleDateString()}.
			</p>
		</div>
	{/if}
</div>
