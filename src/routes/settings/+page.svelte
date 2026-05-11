<script lang="ts">
	import { onMount } from 'svelte';
	import { getAll, replaceAll } from '$lib/db';
	import { encrypt, decrypt } from '$lib/crypto';
	import { theme, toggleTheme } from '$lib/theme.svelte';

	// ── Budget ────────────────────────────────────────────────────────────────
	let budgetHours = $state(40);

	// ── Export ────────────────────────────────────────────────────────────────
	let exportPassphrase = $state('');
	let exporting        = $state(false);
	let exportDone       = $state(false);

	async function doExport() {
		if (!exportPassphrase) return;
		exporting = true; exportDone = false;
		try {
			const items = await getAll();
			const buf = await encrypt(JSON.stringify(items), exportPassphrase);
			const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
			Object.assign(document.createElement('a'), {
				href: url,
				download: `streamq-${new Date().toISOString().slice(0, 10)}.streamq`
			}).click();
			URL.revokeObjectURL(url);
			exportPassphrase = '';
			exportDone = true;
		} finally { exporting = false; }
	}

	// ── Import ────────────────────────────────────────────────────────────────
	let importFile       = $state<File | null>(null);
	let importPassphrase = $state('');
	let importing        = $state(false);
	let importError      = $state('');
	let importDone       = $state(false);

	function onFileChange(e: Event) {
		importFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		importError = ''; importDone = false;
	}

	async function doImport() {
		if (!importFile || !importPassphrase) return;
		importing = true; importError = ''; importDone = false;
		try {
			await replaceAll(JSON.parse(await decrypt(await importFile.arrayBuffer(), importPassphrase)));
			importFile = null; importPassphrase = ''; importDone = true;
		} catch (e) {
			importError = e instanceof Error ? e.message : 'Import failed.';
		} finally { importing = false; }
	}

	// ── Persistence ───────────────────────────────────────────────────────────
	onMount(() => {
		try { budgetHours = JSON.parse(localStorage.getItem('sq:budget') ?? '40'); } catch {}
	});

	$effect(() => {
		try { localStorage.setItem('sq:budget', JSON.stringify(budgetHours)); } catch {}
	});
</script>

<svelte:head><title>StreamQ — Settings</title></svelte:head>

<div class="mx-auto max-w-md space-y-10">
	<h1 class="text-2xl font-bold">Settings</h1>

	<!-- Appearance -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Appearance</h2>
		<div class="flex items-center justify-between">
			<span class="text-sm text-gray-600 dark:text-gray-400">Theme</span>
			<button
				onclick={toggleTheme}
				class="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
			>
				{#if theme.dark}
					☀ Light mode
				{:else}
					☾ Dark mode
				{/if}
			</button>
		</div>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Budget -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Viewing Budget</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Sets the monthly watch-time budget used to normalise runtime bars in all views.
		</p>
		<div class="flex items-center gap-3">
			<input
				type="number" min="10" max="500" step="5"
				bind:value={budgetHours}
				class="w-24 rounded-lg bg-gray-100 px-3 py-2 text-center text-sm font-medium text-gray-900 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:ring-gray-700 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
			/>
			<span class="text-sm text-gray-600 dark:text-gray-400">hours / month</span>
		</div>
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Export -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Export Watchlist</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Downloads your queue as an encrypted <code class="text-orange-500">. streamq</code> file. Choose a passphrase you'll remember — it's required to import.
		</p>
		<div class="flex gap-2">
			<input
				type="password"
				placeholder="Passphrase"
				bind:value={exportPassphrase}
				class="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				onkeydown={(e) => e.key === 'Enter' && doExport()}
			/>
			<button
				class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				disabled={!exportPassphrase || exporting}
				onclick={doExport}
			>
				{exporting ? 'Encrypting…' : 'Download'}
			</button>
		</div>
		{#if exportDone}
			<p class="text-xs text-teal-600 dark:text-teal-400">✓ File downloaded.</p>
		{/if}
	</section>

	<div class="border-t border-gray-200 dark:border-gray-800"></div>

	<!-- Import -->
	<section class="space-y-3">
		<h2 class="text-sm font-semibold uppercase tracking-widest text-gray-500">Import Watchlist</h2>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Restore from a <code class="text-orange-500">.streamq</code> file.
			<span class="font-medium text-red-500">This replaces your current queue.</span>
		</p>
		<input
			type="file" accept=".streamq"
			class="w-full cursor-pointer rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-200 file:px-3 file:py-1 file:text-xs file:font-medium file:text-gray-700 hover:file:bg-gray-300 dark:bg-gray-900 dark:text-gray-300 dark:file:bg-gray-800 dark:file:text-gray-200 dark:hover:file:bg-gray-700"
			onchange={onFileChange}
		/>
		<div class="flex gap-2">
			<input
				type="password"
				placeholder="Passphrase"
				bind:value={importPassphrase}
				class="flex-1 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none ring-1 ring-gray-300 focus:ring-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500 dark:ring-gray-700"
				onkeydown={(e) => e.key === 'Enter' && doImport()}
			/>
			<button
				class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-400 disabled:opacity-50"
				disabled={!importFile || !importPassphrase || importing}
				onclick={doImport}
			>
				{importing ? 'Decrypting…' : 'Import'}
			</button>
		</div>
		{#if importError}<p class="text-xs text-red-500">{importError}</p>{/if}
		{#if importDone}<p class="text-xs text-teal-600 dark:text-teal-400">✓ Queue replaced successfully.</p>{/if}
	</section>
</div>
